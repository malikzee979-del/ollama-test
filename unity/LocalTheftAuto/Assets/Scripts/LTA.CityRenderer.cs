/* ==========================================================================
   Local Theft Auto — 3D city renderer (Gotham-style skyline).
   The city is real geometry now: per-block ground quads textured with the
   same CPU-baked tile art as the 2D version, stepped "wedding-cake" tower
   masses (base + inset setback tiers + spire/roof tank) with baked window
   textures and textured roofs, pole streetlights and simple 3D trees.
   Blocks are built lazily (nearest-first, a few per frame) and then kept —
   the whole world is only 100 blocks. Every tower tier gets a BoxCollider
   so the chase camera can avoid clipping through them.
   ========================================================================== */
using System.Collections.Generic;
using UnityEngine;

namespace LocalTheftAuto
{
    public class CityRenderer : MonoBehaviour
    {
        const int Blocks = Cfg.World / Cfg.BlockTiles;   // 144/10 = 14 -> block indices 0..14
                                                         // (the build loops are inclusive, so 15x15 = 225 blocks)
        const int BlockPx = Cfg.BlockTiles * Cfg.Tile;   // 480
        const int Margin = Cfg.Tile;                     // bake 1 tile extra for cross-tile props
        const int GroundTex = BlockPx + Margin * 2;      // 576
        const int RoofTex = 5 * Cfg.Tile;                // 240
        // Streaming (Phase 1). Blocks are built within BuildRadius of the
        // player and released past EvictRadius. Two things bound BuildRadius:
        //
        //   - RenderSettings.fogEndDistance is 2600 (1500 while raining), so
        //     every pixel past 2600 units is 100% fog colour. Geometry there
        //     is invisible and not worth the VRAM — BuildRadius only has to
        //     reach fogEnd plus one block of slack so a block is never
        //     half-built at the fog wall. cam.farClipPlane (3200) is NOT the
        //     binding constraint; fog is.
        //   - EvictRadius carries the hysteresis. It must exceed BuildRadius
        //     by more than one block diagonal (480*sqrt(2) ~ 679) or a player
        //     sitting on the boundary builds and releases the same block every
        //     frame. The band is kept as tight as that allows because the
        //     resident set scales with the EVICT disc, not the build disc —
        //     a loose 1.4x multiplier would keep ~all 225 blocks resident and
        //     save nothing.
        //
        // Note the honest ceiling: the city is only ~7200 units across while
        // the fog wall sits at 2600, so a large fraction of it is inside view
        // distance no matter what. Eviction bounds growth and cuts roughly
        // 40-50% of the old always-resident ~335 MB; it cannot get near zero.
        const float BuildRadius = 3000f;
        const float EvictRadius = 3700f;

        // Bake budget (Phase 1.3). The old inline `firstSync ? 12 : 2` put
        // twelve 576x576 CPU bakes — ~15 MB of SetPixels32 plus the matching
        // transient Color32 buffers — into a single frame, which is a visible
        // hitch on the very first frame the city appears. Halved the burst and
        // raised the trickle so the same in-fog block set fills in about as
        // fast overall without the spike: at BlocksPerFrame the resident set
        // is complete in well under a second, and the -lta-shot= harness waits
        // 1.2s before capturing, so it still sees a full city.
        const int FirstSyncBudget = 6;
        const int BlocksPerFrame = 3;

        readonly Dictionary<long, Texture2D> groundTexCache = new Dictionary<long, Texture2D>();
        readonly Dictionary<long, Texture2D> roofTexCache = new Dictionary<long, Texture2D>();
        // Replaces the old HashSet<long> built: eviction needs the block's
        // root Transform to destroy it, and ContainsKey covers the "already
        // built?" test the build loop used to ask the HashSet.
        readonly Dictionary<long, Transform> blockRoots = new Dictionary<long, Transform>();
        // Reused across eviction passes so streaming allocates nothing per
        // frame (the dictionary can't be mutated while being enumerated).
        readonly List<long> evictScratch = new List<long>();
        // Realism pass: every block's ground MeshRenderer, so Sync() can
        // swap dry/wet materials on the whole built city in one pass when
        // the weather flips (built is small — ~100 blocks — so this is cheap).
        readonly List<MeshRenderer> groundRenderers = new List<MeshRenderer>();
        // Realism pass (Phase 5): every built traffic signal, lenses driven
        // each frame from the stateless phase (distance-culled). One per
        // corner tile — a block builds at most a handful.
        readonly List<TrafficSignal> trafficSignals = new List<TrafficSignal>();
        static readonly Color LightDim = new Color(0.16f, 0.16f, 0.16f);
        bool wasRaining;
        // Every street lamp owns a real point light now (URP Forward+). There
        // are several hundred across the map, so they are created disabled and
        // only the ones near the player are switched on each frame — see
        // StepLampLights. Iterating the list is trivial next to letting the
        // renderer cull hundreds of live lights every frame.
        readonly List<Light> lampLights = new List<Light>();
        const float LampLightRadius = 620f;
        // Realism pass (Phase 14): breakable streetlights. One entry per
        // built lamp; StepLampPoles checks each unbroken pole against every
        // car and topples it (see Cfg.LampBreakRadius/LampBreakMinSpeed)
        // once one hits it hard enough.
        readonly List<LampPole> lampPoles = new List<LampPole>();

        // Root is the lamp's own root transform — MeshKit.BuildLamp positions
        // it exactly at the pole's ground-level base, so rotating Root in
        // place tips the whole pole/head/glow/light subtree over around that
        // base with no separate hinge object needed.
        class LampPole
        {
            public Transform Root;
            public Light HeadLight;
            public SpriteRenderer Glow;
            public bool Broken;
            public float FallT;         // 0..1 toppling progress
            public Quaternion StartRot; // rotation at the moment it broke
            public Quaternion FallRot;  // resting rotation once fully toppled
        }
        Texture2D[] wallTex;
        Material[] wallMat;
        Texture2D[] shopTex;      // ground-floor shopfront band
        Material[] shopMat;
        // Phase 11: height fields matching the two above, pixel for pixel.
        // Kept as fields only so they stay alive for the process lifetime the
        // same way their albedo counterparts do.
        Texture2D[] wallBump;
        Texture2D[] shopBump;
        Transform cityRoot;
        bool firstSync = true;
        // set when an eviction destroys block components; cleared by the
        // CompactVisualLists pass on the FOLLOWING Sync, once Destroy has
        // actually taken effect and the stale references read as null
        bool compactPending;

        // lit shop signage — all bright enough to clear the shader's emissive
        // luminance threshold so they glow after dark
        static readonly Color[] SignColors =
        {
            Cfg.Hex("#ff7a4d"), Cfg.Hex("#4fd1ff"), Cfg.Hex("#ffd24f"), Cfg.Hex("#ff7ab8")
        };

        static long Key(int bx, int by) { return by * 100L + bx; }

        // District(bx,by): purely cosmetic block classification, driven by
        // a hash pair distinct from BlockHash so it never disturbs the
        // road/sidewalk/building/park occupancy that BlockHash already
        // decides (that stays byte-for-byte with the JS original). 0 =
        // Residential (shorter, warm walls), 1 = Downtown (taller, cool
        // walls, more neon), 2 = Industrial (mid-height, muted, flat roofs).
        public const int Residential = 0, Downtown = 1, Industrial = 2;

        public static int District(int bx, int by)
        {
            double h = JSRng.BlockHash(bx * 17 + 3, by * 11 + 5);
            if (h < 0.38) return Residential;
            if (h < 0.72) return Downtown;
            return Industrial;
        }

        public void Init()
        {
            SpriteKit.Init();
            MeshKit.Init();
            cityRoot = new GameObject("city").transform;

            // window texture variants for building walls
            wallTex = new Texture2D[4];
            wallMat = new Material[4];
            wallBump = new Texture2D[4];
            for (int i = 0; i < 4; i++)
            {
                wallTex[i] = BakeWallTex(i);
                wallMat[i] = new Material(Resources.Load<Shader>("LTA-Lit")) { mainTexture = wallTex[i] };
                // the baked wall art's bright texels are the lit windows —
                // let them glow on their own once the sun is down
                // 1.5 pushed lit panes past 1.0 and clipped them to flat
                // white; at 0.6 they keep their warm/cool color and read as
                // lit rooms rather than holes cut in the building
                wallMat[i].SetFloat("_EmissStrength", 0.6f);
                // sits between the concrete wall albedo (~0.44 luminance) and
                // the lit window panes (~0.83), so only the windows glow
                wallMat[i].SetFloat("_EmissThreshold", 0.60f);
                wallMat[i].SetFloat("_Gloss", 0.42f);        // glazing catches the sun
                wallMat[i].SetFloat("_SpecStrength", 0.5f);
                // Phase 11: window reveals stop being painted-on rectangles.
                // Scale kept low — one texture repeat spans 192 world units,
                // so a large value turns a 24-unit window into a crater.
                wallBump[i] = BakeWallHeight(i);
                wallMat[i].SetTexture("_BumpMap", wallBump[i]);
                wallMat[i].SetFloat("_BumpScale", 0.6f);
            }

            // ground-floor shopfronts
            shopTex = new Texture2D[4];
            shopMat = new Material[4];
            shopBump = new Texture2D[4];
            for (int i = 0; i < 4; i++)
            {
                shopTex[i] = BakeShopTex(i);
                shopMat[i] = new Material(Resources.Load<Shader>("LTA-Lit")) { mainTexture = shopTex[i] };
                // Shop glazing and signage are the brightest things at street
                // level at night, so they carry more emission than the towers —
                // but 0.95 blew the sign boards into flat glare, so this sits
                // just above the tower walls' 0.6 rather than well above it.
                shopMat[i].SetFloat("_EmissStrength", 0.72f);
                shopMat[i].SetFloat("_EmissThreshold", 0.60f);
                shopMat[i].SetFloat("_Gloss", 0.5f);
                shopMat[i].SetFloat("_SpecStrength", 0.6f);
                // Phase 11: plinth, mullions, fascia and cornice pick up real
                // relief. Pushed harder than the tower walls because this band
                // is at eye level and fills the frame at street speed.
                shopBump[i] = BakeShopHeight(i);
                shopMat[i].SetTexture("_BumpMap", shopBump[i]);
                shopMat[i].SetFloat("_BumpScale", 0.9f);
            }

            // dark base plane so the horizon isn't a void at the city edge
            var basePlane = new GameObject("base-plane");
            basePlane.transform.SetParent(cityRoot, false);
            var mf = basePlane.AddComponent<MeshFilter>();
            float w = Cfg.World * Cfg.Tile;
            mf.sharedMesh = MeshKit.QuadMeshXZ(w * 5f, w * 5f, 0, 0, 1, 1, Cfg.Hex("#232833"));
            var mr = basePlane.AddComponent<MeshRenderer>();
            mr.sharedMaterial = MeshKit.White;
            basePlane.transform.position = new Vector3(w / 2f, -0.6f, -w / 2f);

            BuildMountains(w);
        }

        // Decorative mountain range ringing the whole playable area, well
        // outside the World bounds (which already collide as solid, like a
        // building, so nothing can actually reach these). Faceted
        // overlapping pyramids at varying size/height/haze read as a
        // distant range and give the city an edge instead of trailing off
        // into a flat void — this is pure backdrop, no collision needed.
        void BuildMountains(float worldSize)
        {
            var root = new GameObject("mountains").transform;
            root.SetParent(cityRoot, false);
            float ring = worldSize * 0.62f;         // distance of the range from the city center
            int count = 46;
            for (int i = 0; i < count; i++)
            {
                double h1 = JSRng.Hash2(i * 17 + 3, 91);
                double h2 = JSRng.Hash2(i * 23 + 7, 131);
                double h3 = JSRng.Hash2(i * 29 + 11, 173);
                float ang = (i + (float)h1 * 0.6f) / count * Mathf.PI * 2f;
                float dist = ring + (float)h2 * worldSize * 0.22f;
                float px = worldSize / 2f + Mathf.Cos(ang) * dist;
                float py = worldSize / 2f + Mathf.Sin(ang) * dist;
                float baseW = 260f + (float)h1 * 520f;
                float peakH = 180f + (float)h3 * 480f;
                // haze with distance: farther/taller peaks fade cooler and
                // dimmer, like atmospheric perspective
                float haze = Mathf.Clamp01((dist - ring) / (worldSize * 0.22f));
                Color rock = Color.Lerp(Cfg.Hex("#6b7585"), Cfg.Hex("#39424e"), haze * 0.6f + 0.15f);
                var mesh = MeshKit.PyramidCapMesh(baseW, baseW * (0.75f + (float)h2 * 0.5f), peakH, rock);
                var go = new GameObject("peak");
                go.transform.SetParent(root, false);
                go.transform.position = MeshKit.V3(px, py, -20f); // sunk a little so no gap shows at the base
                go.transform.Rotate(0f, (float)h3 * 360f, 0f, Space.Self);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr2 = go.AddComponent<MeshRenderer>();
                mr2.sharedMaterial = MeshKit.White;
            }
        }

        /* ------------------------------------------------------ per frame */

        // Build the nearest not-yet-built blocks around the player: a burst on
        // the first frame, then a trickle so there is never a bake hitch.
        public void Sync(GameData gd, float playerX, float playerY, bool raining = false, float time = 0f, float dt = 0f)
        {
            StepLampLights(playerX, playerY);
            StepTrafficLights(time, playerX, playerY);
            StepLampPoles(gd, dt);

            if (raining != wasRaining)
            {
                wasRaining = raining;
                for (int i = 0; i < groundRenderers.Count; i++)
                {
                    var mr = groundRenderers[i];
                    if (mr == null) continue;
                    Texture tex = mr.sharedMaterial.mainTexture;
                    mr.sharedMaterial = raining ? MeshKit.WetMat(tex) : MeshKit.Mat(tex);
                }
            }

            // Compact the flat visual lists on the frame AFTER an eviction,
            // not during it: Destroy() is deferred to end of frame, so the
            // entries belonging to a block evicted this frame still compare
            // non-null right now and would survive the pass.
            if (compactPending) { CompactVisualLists(); compactPending = false; }

            EvictFarBlocks(playerX, playerY);

            int budget = firstSync ? FirstSyncBudget : BlocksPerFrame;
            firstSync = false;

            float buildR2 = BuildRadius * BuildRadius;
            for (int n = 0; n < budget; n++)
            {
                int bestBx = -1, bestBy = -1;
                float bestD = buildR2;
                for (int by = 0; by <= Blocks; by++)
                {
                    for (int bx = 0; bx <= Blocks; bx++)
                    {
                        if (blockRoots.ContainsKey(Key(bx, by))) continue;
                        float cx = bx * BlockPx + BlockPx / 2f;
                        float cy = by * BlockPx + BlockPx / 2f;
                        float dx = cx - playerX, dy = cy - playerY;
                        float d = dx * dx + dy * dy;
                        // Only blocks inside the fog wall are worth building;
                        // bestD starts at buildR2, so this test doubles as the
                        // radius gate and the nearest-first pick.
                        if (d < bestD) { bestD = d; bestBx = bx; bestBy = by; }
                    }
                }
                // Nothing unbuilt inside BuildRadius. This is now a normal
                // steady state rather than "the whole city is done", because
                // eviction puts blocks back on the menu as the player moves.
                if (bestBx < 0) break;
                BuildBlock(bestBx, bestBy);
            }
        }

        // Releases every block whose centre is past EvictRadius: the root
        // GameObject subtree (ground quad, tower tiers, props, lamps,
        // signals), the block's baked ground/roof textures, and the MeshKit
        // materials cached against those textures.
        //
        // Order matters — MeshKit.ReleaseMat BEFORE Destroy(tex). The
        // material dictionaries are keyed on the Texture object, and once the
        // texture is destroyed the key still hashes but points at a dead
        // texture, so a later rebuild of the same block would get handed a
        // material whose mainTexture is gone (magenta ground).
        //
        // The shared wallTex/shopTex arrays are deliberately NOT touched:
        // they are built once in Init() and assigned to wallMat/shopMat
        // directly, never routed through MeshKit.Mat/WetMat, so they are not
        // in those dictionaries and cannot be released by this path.
        void EvictFarBlocks(float playerX, float playerY)
        {
            float evictR2 = EvictRadius * EvictRadius;
            evictScratch.Clear();
            foreach (KeyValuePair<long, Transform> kv in blockRoots)
            {
                long key = kv.Key;
                int bx = (int)(key % 100L), by = (int)(key / 100L);
                float cx = bx * BlockPx + BlockPx / 2f;
                float cy = by * BlockPx + BlockPx / 2f;
                float dx = cx - playerX, dy = cy - playerY;
                if (dx * dx + dy * dy > evictR2) evictScratch.Add(key);
            }
            if (evictScratch.Count == 0) return;

            for (int i = 0; i < evictScratch.Count; i++)
            {
                long key = evictScratch[i];
                Transform root;
                if (blockRoots.TryGetValue(key, out root))
                {
                    blockRoots.Remove(key);
                    // Destroying the root takes the whole subtree with it —
                    // every lamp Light, signal lens and tier MeshRenderer is a
                    // descendant, so nothing needs releasing one by one.
                    if (root != null) Destroy(root.gameObject);
                }
                ReleaseBlockTex(groundTexCache, key);
                ReleaseBlockTex(roofTexCache, key);
            }
            // the destroyed components go null at end of frame; compact then
            compactPending = true;
        }

        static void ReleaseBlockTex(Dictionary<long, Texture2D> cache, long key)
        {
            Texture2D tex;
            if (!cache.TryGetValue(key, out tex)) return;
            cache.Remove(key);
            if (tex == null) return;
            MeshKit.ReleaseMat(tex);
            Destroy(tex);
        }

        // Drops the entries whose GameObjects were destroyed by an eviction.
        // All three consumers (StepLampLights, StepTrafficLights, the wet/dry
        // swap above) already null-check per item, so a stale entry was never
        // a crash risk — but the lists only ever grew, so a long drive with
        // streaming would walk hundreds of dead references every frame.
        void CompactVisualLists()
        {
            groundRenderers.RemoveAll(mr => mr == null);
            lampLights.RemoveAll(l => l == null);
            trafficSignals.RemoveAll(s => s == null || s.Root == null);
            lampPoles.RemoveAll(p => p == null || p.Root == null);
        }

        // Realism pass (Phase 14): breakable streetlights. A car — player,
        // traffic, or a chasing cop — moving faster than
        // Cfg.LampBreakMinSpeed within Cfg.LampBreakRadius of an unbroken
        // pole snaps it: the pole topples away along the car's own travel
        // direction, its light and glow pool cut out, the car sheds a
        // little of its speed on the impact, and a small dust puff plus a
        // camera-shake bump sell the hit — the same beat as clipping a
        // lamppost in a GTA-style game instead of driving straight through
        // an invisible prop. Already-broken poles just keep animating their
        // fall until FallT reaches 1.
        void StepLampPoles(GameData d, float dt)
        {
            if (d == null) return;
            for (int i = 0; i < lampPoles.Count; i++)
            {
                LampPole pole = lampPoles[i];
                if (pole.Root == null) continue;
                if (!pole.Broken)
                {
                    List<CarEnt> cars = d.Cars;
                    bool broke = false;
                    for (int j = 0; j < cars.Count && !broke; j++)
                    {
                        CarEnt c = cars[j];
                        float spd = Mathf.Sqrt(c.Vx * c.Vx + c.Vy * c.Vy);
                        if (BreakPole(pole, d, c.X, c.Y, c.Vx, c.Vy, spd))
                        {
                            c.Speed *= Cfg.LampBreakSpeedLoss;
                            c.Vx *= Cfg.LampBreakSpeedLoss;
                            c.Vy *= Cfg.LampBreakSpeedLoss;
                            broke = true;
                        }
                    }
                    List<CopEnt> cops = d.Cops;
                    for (int j = 0; j < cops.Count && !broke; j++)
                    {
                        CopEnt c = cops[j];
                        if (c.Roadblock) continue;
                        float vx = Mathf.Cos(c.A) * c.Speed, vy = Mathf.Sin(c.A) * c.Speed;
                        if (BreakPole(pole, d, c.X, c.Y, vx, vy, c.Speed))
                        {
                            c.Speed *= Cfg.LampBreakSpeedLoss;
                            broke = true;
                        }
                    }
                }
                else if (pole.FallT < 1f)
                {
                    pole.FallT = Mathf.Min(1f, pole.FallT + dt / Cfg.LampFallDuration);
                    // ease-out: fast off the top, settling into the last
                    // bit of the fall — reads as toppling, not a linear tip
                    float e = 1f - (1f - pole.FallT) * (1f - pole.FallT);
                    pole.Root.rotation = Quaternion.Slerp(pole.StartRot, pole.FallRot, e);
                }
            }
        }

        // Shared break test/trigger for one candidate (car or cop). Returns
        // true the one frame it actually snaps the pole; the caller is left
        // to apply its own speed penalty since CarEnt/CopEnt don't share a
        // base type.
        bool BreakPole(LampPole pole, GameData d, float carX, float carY, float vx, float vy, float speed)
        {
            if (speed < Cfg.LampBreakMinSpeed) return false;
            Vector3 pos = pole.Root.position;
            // Unity space: world.x = jsX, world.z = -jsY (see StepLampLights).
            float poleX = pos.x, poleY = -pos.z;
            float dx = carX - poleX, dy = carY - poleY;
            if (dx * dx + dy * dy > Cfg.LampBreakRadius * Cfg.LampBreakRadius) return false;

            pole.Broken = true;
            pole.StartRot = pole.Root.rotation;
            // fall away along the car's own travel direction — JS bearing
            // (x right, y down) maps to Unity's (cos, 0, -sin) on the ground
            // plane, same convention MeshKit.V3 uses everywhere else.
            float travelRad = Mathf.Atan2(vy, vx);
            Vector3 fallDirWorld = new Vector3(Mathf.Cos(travelRad), 0f, -Mathf.Sin(travelRad));
            Vector3 axis = Vector3.Cross(Vector3.up, fallDirWorld).normalized;
            if (axis.sqrMagnitude < 0.0001f) axis = Vector3.right;
            pole.FallRot = Quaternion.AngleAxis(Cfg.LampFallAngle, axis) * pole.StartRot;
            pole.FallT = 0f;
            if (pole.HeadLight != null) pole.HeadLight.enabled = false;
            if (pole.Glow != null) pole.Glow.enabled = false;
            Systems.AddSmoke(d, poleX, poleY);
            d.State.Shake = Mathf.Min(14f, d.State.Shake + Cfg.LampBreakShake);
            return true;
        }

        // Switches on only the street lamps close enough to matter. The
        // simulation is in JS space (x right, y DOWN) while the lights live
        // in Unity space, where MeshKit.V3 maps world.x = jsX and
        // world.z = -jsY — so the y comparison has to un-negate z.
        void StepLampLights(float playerX, float playerY)
        {
            float r2 = LampLightRadius * LampLightRadius;
            // Realism pass: the 1-2 lamps nearest the player cast soft
            // shadows (contact shadows right overhead where they read);
            // the other hundreds stay shadowless. Tracked with two slots —
            // no per-frame allocation.
            Light n0 = null, n1 = null;
            float d0 = float.MaxValue, d1 = float.MaxValue;
            int shadowCount = Cfg.EnablePunctualShadows ? Cfg.NearLampShadowCount : 0;
            for (int i = 0; i < lampLights.Count; i++)
            {
                Light l = lampLights[i];
                if (l == null) continue;
                Vector3 p = l.transform.position;
                float dx = p.x - playerX;
                float dy = -p.z - playerY;
                float d = dx * dx + dy * dy;
                bool near = d < r2;
                if (l.enabled != near) l.enabled = near;
                if (near && shadowCount > 0)
                {
                    if (d < d0) { n1 = n0; d1 = d0; n0 = l; d0 = d; }
                    else if (shadowCount > 1 && d < d1) { n1 = l; d1 = d; }
                }
            }
            if (shadowCount == 0) return;
            for (int i = 0; i < lampLights.Count; i++)
            {
                Light l = lampLights[i];
                if (l == null) continue;
                LightShadows want = (l == n0 || (shadowCount > 1 && l == n1)) ? LightShadows.Soft : LightShadows.None;
                if (l.shadows != want) l.shadows = want;
            }
        }

        // Realism pass (Phase 5): drive nearby traffic signals from the same
        // stateless phase function the AI consults. Tinting a lens to white
        // lights it (the emissive material's luminance-threshold glow kicks
        // in), dimming to LightDim kills it. Distance-culled — the player
        // only ever sees the lights around them, and signals accumulate as
        // more blocks get built over a session.
        void StepTrafficLights(float time, float playerX, float playerY)
        {
            float cull2 = Cfg.LightUpdateRadius * Cfg.LightUpdateRadius;
            for (int i = 0; i < trafficSignals.Count; i++)
            {
                TrafficSignal s = trafficSignals[i];
                if (s.Root == null) continue;
                Vector3 p = s.Root.transform.position;
                float dx = p.x - playerX, dy = -p.z - playerY;
                if (dx * dx + dy * dy > cull2) continue;
                int ph = TrafficLights.Phase(s.CornerBx, s.CornerBy, s.Facing, time);
                MeshKit.Tint(s.LensR, ph == TrafficLights.Red ? Color.white : LightDim);
                MeshKit.Tint(s.LensA, ph == TrafficLights.Amber ? Color.white : LightDim);
                MeshKit.Tint(s.LensG, ph == TrafficLights.Green ? Color.white : LightDim);
            }
        }

        /* ---------------------------------------------------- block build */

        void BuildBlock(int bx, int by)
        {
            var root = new GameObject("block " + bx + "," + by).transform;
            root.SetParent(cityRoot, false);
            // Registered AFTER the root exists so eviction always has a
            // transform to destroy. This is also the block's "is built" mark —
            // the build loop tests blockRoots.ContainsKey, so a block can never
            // be registered without geometry or vice versa.
            blockRoots[Key(bx, by)] = root;

            // ground quad, textured with the baked tile art (margin inset)
            float m = Margin / (float)GroundTex;
            var gq = new GameObject("ground");
            gq.transform.SetParent(root, false);
            gq.transform.position = MeshKit.V3(bx * BlockPx + BlockPx / 2f, by * BlockPx + BlockPx / 2f, 0f);
            var gmf = gq.AddComponent<MeshFilter>();
            gmf.sharedMesh = MeshKit.QuadMeshXZ(BlockPx, BlockPx, m, 1f - m, 1f - m, m, Color.white);
            var gmr = gq.AddComponent<MeshRenderer>();
            gmr.sharedMaterial = wasRaining ? MeshKit.WetMat(GetGroundTex(bx, by)) : MeshKit.Mat(GetGroundTex(bx, by));
            groundRenderers.Add(gmr);

            double bh = JSRng.BlockHash(bx, by);
            float x0 = (bx * Cfg.BlockTiles + 4) * Cfg.Tile;
            float y0 = (by * Cfg.BlockTiles + 4) * Cfg.Tile;
            float fw = 5 * Cfg.Tile;

            if (CityMap.IsRiverBlock(by))
            {
                // river block: no buildings/park here — the tile-level
                // TileType() already turned this block's own avenue lane
                // into a bridge deck (Road/Side) with open water either
                // side of it; just dress that up with rails and pilings.
                BuildBridgeProps(root, bx, by);
            }
            else if (bh >= 0.16)
            {
                // Gotham-style tower: District shapes the height band and
                // wall tint on top of the JS-exact bh value — Downtown reads
                // taller and cooler, Residential shorter and warmer,
                // Industrial squat and flat. BuildSkyscraper() below turns
                // that into a stepped, wedding-cake mass instead of a
                // single box: a wide street-level base, one or two inset
                // setback tiers as it climbs, and — on the tallest downtown
                // towers — a steel spire with a warning light, so the
                // skyline reads like a real city instead of a grid of crates.
                int district = District(bx, by);
                BuildSkyscraper(root, bx, by, x0, y0, fw, bh, district);
            }
            else
            {
                // park trees, same hash positions as the baked shadows
                for (int i = 0; i < 6; i++)
                {
                    double th = JSRng.Hash2(bx * 31 + i, by * 17 + i);
                    float px = x0 + 20 + (float)(th * (fw - 40));
                    float py = y0 + 20 + (float)(JSRng.Hash2(bx * 13 + i, by * 29 + i) * (fw - 40));
                    MeshKit.BuildTree(MeshKit.V3(px, py, 0f), (float)th).transform.SetParent(root, true);
                }
            }

            // streetlights on sidewalk corners + sidewalk trees (same rules
            // as the 2D drawStreetProps port)
            for (int ry = 0; ry < Cfg.BlockTiles; ry++)
            {
                for (int rx = 0; rx < Cfg.BlockTiles; rx++)
                {
                    int tx = bx * Cfg.BlockTiles + rx, ty = by * Cfg.BlockTiles + ry;
                    if (CityMap.TileType(tx, ty) != Cfg.Side) continue;
                    bool corner = (rx == 3 || rx == 9) && (ry == 3 || ry == 9);
                    float cxw = tx * Cfg.Tile + Cfg.Tile / 2f;
                    float cyw = ty * Cfg.Tile + Cfg.Tile / 2f;

                    // Corners carry either a streetlight or a traffic signal;
                    // mid-block pavement carries trees and the small stuff.
                    // Bare pavement is one of the strongest "generated" tells,
                    // so most tiles get something.
                    if (corner)
                    {
                        double h = JSRng.Hash2(tx, ty);
                        if (h < 0.6)
                        {
                            float gx = tx * Cfg.Tile + (rx == 3 ? -20f : Cfg.Tile + 20f);
                            float gy = ty * Cfg.Tile + (ry == 3 ? -20f : Cfg.Tile + 20f);
                            var lampGo = MeshKit.BuildLamp(MeshKit.V3(cxw, cyw, 0f), MeshKit.V3(gx, gy, 0f));
                            lampGo.transform.SetParent(root, true);
                            var lampLight = lampGo.GetComponentInChildren<Light>(true);
                            if (lampLight != null) lampLights.Add(lampLight);
                            lampPoles.Add(new LampPole
                            {
                                Root = lampGo.transform,
                                HeadLight = lampLight,
                                Glow = lampGo.GetComponentInChildren<SpriteRenderer>(true)
                            });
                        }
                        else if (h < 0.88)
                        {
                            // Realism pass (Phase 5): record which block-corner
                            // crossing the signal serves. A corner tile at the
                            // block's far (rx==9/ry==9) edge fronts the NEXT
                            // block's crossing; the near edge fronts this one.
                            var sig = MeshKit.BuildTrafficLight(
                                MeshKit.V3(cxw, cyw, 0f), (float)JSRng.Hash2(tx * 3, ty * 3));
                            sig.Root.transform.SetParent(root, true);
                            sig.CornerBx = bx + (rx == 9 ? 1 : 0);
                            sig.CornerBy = by + (ry == 9 ? 1 : 0);
                            trafficSignals.Add(sig);
                        }
                    }
                    else
                    {
                        double h = JSRng.Hash2(tx * 5, ty * 5);
                        // nudge props off the tile centre so a street doesn't
                        // read as evenly spaced dots
                        float jx = cxw + ((float)JSRng.Hash2(tx * 11, ty * 7) - 0.5f) * 16f;
                        float jy = cyw + ((float)JSRng.Hash2(tx * 7, ty * 11) - 0.5f) * 16f;

                        if (h < 0.12)
                        {
                            MeshKit.BuildTree(MeshKit.V3(cxw, cyw, 0f), (float)JSRng.Hash2(tx, ty))
                                   .transform.SetParent(root, true);
                        }
                        else if (h < 0.19)
                        {
                            MeshKit.BuildHydrant(MeshKit.V3(jx, jy, 0f)).transform.SetParent(root, true);
                        }
                        else if (h < 0.26)
                        {
                            MeshKit.BuildBin(MeshKit.V3(jx, jy, 0f), (float)JSRng.Hash2(tx * 13, ty * 17))
                                   .transform.SetParent(root, true);
                        }
                        else if (h < 0.31)
                        {
                            MeshKit.BuildStreetBox(MeshKit.V3(jx, jy, 0f), (float)JSRng.Hash2(tx * 19, ty * 23))
                                   .transform.SetParent(root, true);
                        }
                    }
                }
            }
        }

        // Dresses up a river block's bridge lane: steel guardrails along
        // both edges of the deck (where it meets open water) and a couple
        // of support pilings standing in the water either side, so the
        // flat road-and-water texture actually reads as a bridge crossing.
        void BuildBridgeProps(Transform root, int bx, int by)
        {
            float y0 = by * BlockPx;
            float railWestX = bx * BlockPx;                    // west edge of this block's avenue lane
            float railEastX = bx * BlockPx + 4 * Cfg.Tile;     // east edge (past the rx==3 sidewalk)
            Color railCol = Cfg.Hex("#77828f");
            MeshKit.Box(root, "bridge-rail-w", 3f, 18f, BlockPx, MeshKit.V3(railWestX, y0 + BlockPx / 2f, 0f), railCol);
            MeshKit.Box(root, "bridge-rail-e", 3f, 18f, BlockPx, MeshKit.V3(railEastX, y0 + BlockPx / 2f, 0f), railCol);

            Color pylonCol = Cfg.Hex("#545c66");
            float pylonX = bx * BlockPx + 7.2f * Cfg.Tile;
            for (int i = 0; i < 2; i++)
            {
                float py = y0 + BlockPx * (i == 0 ? 0.26f : 0.74f);
                MeshKit.Box(root, "pylon", 12f, 34f, 12f, MeshKit.V3(pylonX, py, 0f), pylonCol);
            }
        }

        /* ------------------------------------------------- tower massing */

        // Builds a Gotham-style tower on the lot centered at (x0+fw/2,
        // y0+fw/2): researched from the real design language of the comics/
        // films/games (Anton Furst's Batman '89, Arkham City/Knight, Gotham
        // Knights) — a mix of Gothic (spires, pointed roofs, corner
        // turrets, cornice ledges) and Art Deco (stepped setback massing
        // that actually tapers, not just stacks). Concretely: a
        // full-footprint base tier, then 0-2 inset setback tiers as it
        // climbs — each tier is itself a continuous taper (TaperBoxMesh),
        // not a flat-sided box — separated by protruding cornice ledges,
        // with the base corners sometimes carrying small pinnacle turrets,
        // and a crown that's either a Gothic pointed spire, an Art Deco
        // antenna mast with a warning light, or (shorter buildings) a plain
        // roof tank. Every tier keeps its own BoxCollider so the chase
        // camera still avoids clipping through any part of the mass.
        void BuildSkyscraper(Transform root, int bx, int by, float x0, float y0, float fw, double bh, int district)
        {
            float baseH = 120f + (float)bh * 300f;                       // 120..420
            float heightMul = district == Downtown ? 1.8f + (float)bh * 1.3f   // up to ~4.5x: dominant spires
                             : district == Industrial ? 0.55f
                             : 0.95f;
            float totalH = Mathf.Min(baseH * heightMul, 1400f);

            int variant = Mathf.Clamp((int)((bh - 0.16) / 0.84 * 4.0), 0, 3);
            float g = 0.85f + (float)JSRng.Hash2(bx * 3, by * 7) * 0.3f;
            if (district == Residential) g *= 1.08f;        // warmer/lighter walls
            else if (district == Industrial) g *= 0.82f;    // muted
            Color wallCol = new Color(g, g, g);
            Color stoneCol = Color.Lerp(wallCol, Cfg.Hex("#5a616b"), 0.5f); // cornices/turrets: darker trim stone

            // tier count: tall Downtown towers usually get 2-3 setbacks,
            // shorter/other-district blocks stay a single slab or two
            double tierRoll = JSRng.Hash2(bx * 41 + 5, by * 23 + 9);
            int tiers = 1;
            if (district == Downtown && totalH > 260f) tiers = tierRoll > 0.35 ? 3 : 2;
            else if (totalH > 220f) tiers = tierRoll > 0.6 ? 2 : 1;

            float[] tierH = new float[tiers];
            float[] tierBaseW = new float[tiers];   // width at the bottom of each tier
            float[] tierTopW = new float[tiers];    // width at the top of each tier (after its own taper)
            float remaining = totalH, w = fw;
            for (int i = 0; i < tiers; i++)
            {
                bool last = i == tiers - 1;
                float share = last ? 1f : (i == 0 ? 0.5f : 0.6f);
                tierH[i] = last ? remaining : remaining * share;
                remaining -= tierH[i];
                tierBaseW[i] = w;
                // continuous taper along the tier's own height (~4-10% narrower
                // at the top than the bottom) so walls read as sculpted, not flat
                float selfTaper = 0.90f + (float)JSRng.Hash2(bx * 23 + i, by * 27 + i) * 0.06f;
                tierTopW[i] = w * selfTaper;
                // then the discrete setback shrink into the next tier
                w = tierTopW[i] * (0.68f + (float)JSRng.Hash2(bx * 5 + i, by * 9 + i) * 0.08f);
            }

            float cx = x0 + fw / 2f, cy = y0 + fw / 2f;
            float y = 0f, topCx = cx, topCy = cy;
            for (int i = 0; i < tiers; i++)
            {
                float ox = 0f, oy = 0f;
                if (i > 0)
                {
                    float slack = (tierTopW[i - 1] - tierBaseW[i]) * 0.5f;
                    ox = ((float)JSRng.Hash2(bx * 13 + i, by * 31 + i) - 0.5f) * slack;
                    oy = ((float)JSRng.Hash2(bx * 19 + i, by * 37 + i) - 0.5f) * slack;
                }
                var tgo = new GameObject("tower-tier" + i);
                tgo.transform.SetParent(root, false);
                tgo.transform.position = MeshKit.V3(cx + ox, cy + oy, y);
                var tmf = tgo.AddComponent<MeshFilter>();
                tmf.sharedMesh = MeshKit.TaperBoxMesh(tierBaseW[i], tierBaseW[i], tierTopW[i], tierTopW[i], tierH[i], wallCol, 1f / 192f);
                var tmr = tgo.AddComponent<MeshRenderer>();
                tmr.sharedMaterial = wallMat[variant];
                tgo.AddComponent<BoxCollider>();   // sized to the mesh; camera pull-in

                // cornice ledge: a thin band slightly wider than this tier's
                // own top, marking the setback line — pure Art Deco banding,
                // skipped on the topmost tier (the crown handles that edge)
                if (i < tiers - 1)
                {
                    float ledgeW = tierTopW[i] * 1.10f;
                    MeshKit.Box(root, "ledge", ledgeW, 10f, ledgeW,
                                MeshKit.V3(cx + ox, cy + oy, y + tierH[i] - 5f), stoneCol);
                }

                // corner pinnacle turrets on the exposed base-tier ledge —
                // small Gothic corner towers, capped with their own tiny
                // spire, echoing the Clock Tower / cathedral corner-turret
                // look. Only when there's an actual setback to stand on.
                if (i == 0 && tiers > 1 && JSRng.Hash2(bx * 61 + 3, by * 71 + 7) > 0.45)
                {
                    float turretW = tierTopW[0] * 0.05f;
                    float turretH = 30f + (float)JSRng.Hash2(bx * 81, by * 83) * 50f;
                    float inset = tierTopW[0] * 0.5f - turretW * 0.9f;
                    float[] sxs = { 1f, -1f, 1f, -1f };
                    float[] szs = { 1f, 1f, -1f, -1f };
                    for (int k = 0; k < 4; k++)
                    {
                        Vector3 basePos = MeshKit.V3(cx + ox + sxs[k] * inset, cy + oy + szs[k] * inset, y + tierH[0]);
                        MeshKit.Box(root, "turret", turretW, turretH, turretW, basePos, stoneCol);
                        var tipMesh = MeshKit.PyramidCapMesh(turretW * 1.4f, turretW * 1.4f, turretW * 2.2f, stoneCol);
                        MeshGoAt(root, "turret-cap", tipMesh, basePos + new Vector3(0f, turretH, 0f));
                    }
                }

                y += tierH[i];
                if (i == tiers - 1) { topCx = cx + ox; topCy = cy + oy; }
            }

            // Ground floor: a shopfront/lobby band wrapping the base, sitting
            // slightly proud of the tower wall. Without it every building runs
            // the same window grid straight into the pavement, which is the
            // strongest generated-look tell at street level — real buildings
            // meet the street with glazing, doorways and signage.
            float groundH = Mathf.Min(46f, totalH * 0.35f);
            float shopW = tierBaseW[0] * 1.03f;
            var shopGo = new GameObject("shopfront");
            shopGo.transform.SetParent(root, false);
            shopGo.transform.position = MeshKit.V3(cx, cy, 0f);
            var shopMf = shopGo.AddComponent<MeshFilter>();
            shopMf.sharedMesh = MeshKit.BoxMeshUV(shopW, groundH, shopW, Color.white, 1f / 110f, 1f);
            var shopMr = shopGo.AddComponent<MeshRenderer>();
            shopMr.sharedMaterial = shopMat[variant];

            float towerTopY = y;
            float topW = tierTopW[tiers - 1];

            var rq = new GameObject("roof");
            rq.transform.SetParent(root, false);
            rq.transform.position = MeshKit.V3(topCx, topCy, towerTopY + 0.4f);
            var rmf = rq.AddComponent<MeshFilter>();
            rmf.sharedMesh = MeshKit.QuadMeshXZ(topW, topW, 0f, 1f, 1f, 0f, Color.white);
            var rmr = rq.AddComponent<MeshRenderer>();
            rmr.sharedMaterial = MeshKit.Mat(GetRoofTex(bx, by));

            // crown: a steep Gothic spire on roughly a third of towers (any
            // district — this is the single biggest "not a box" signal),
            // otherwise an Art Deco antenna mast + warning light on tall
            // Downtown towers, or a plain roof tank on shorter buildings
            double crownRoll = JSRng.Hash2(bx * 91 + 11, by * 97 + 13);
            if (crownRoll > 0.65 && totalH > 180f)
            {
                float spireBaseW = topW * 0.55f;
                float spireH = spireBaseW * (1.6f + (float)JSRng.Hash2(bx * 47, by * 53) * 1.4f);
                var spireMesh = MeshKit.PyramidCapMesh(spireBaseW, spireBaseW, spireH, stoneCol);
                MeshGoAt(root, "gothic-spire", spireMesh, MeshKit.V3(topCx, topCy, towerTopY + 0.4f));
                MeshKit.Box(root, "finial", 5f, 26f, 5f,
                            MeshKit.V3(topCx, topCy, towerTopY + spireH), Cfg.Hex("#6a7078"));
            }
            else if (district == Downtown && tierRoll > 0.55 && totalH > 320f)
            {
                float spireH = 60f + (float)JSRng.Hash2(bx * 51, by * 61) * 140f;
                MeshKit.Box(root, "spire", topW * 0.14f, spireH, topW * 0.14f,
                            MeshKit.V3(topCx, topCy, towerTopY), Cfg.Hex("#6a7078"));
                MeshKit.Box(root, "spire-light", 6f, 6f, 6f,
                            MeshKit.V3(topCx, topCy, towerTopY + spireH), Cfg.Hex("#ff3b30"));
            }
            else
            {
                MeshKit.Box(root, "tank", topW * 0.22f, 22f, topW * 0.22f,
                            MeshKit.V3(topCx + topW * 0.22f, topCy - topW * 0.22f, towerTopY), Cfg.Hex("#4a515b"));
            }
        }

        // Parents a pre-built mesh (used for pyramid caps, which have no
        // matching MeshKit.Box overload) at a world position with the
        // shared unlit White material.
        static void MeshGoAt(Transform parent, string name, Mesh mesh, Vector3 worldPos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = worldPos;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = MeshKit.White;
        }

        /* --------------------------------------------------- pixel buffer */

        struct PBuf
        {
            public Color32[] Px; public int W, H;

            public void BlendPixel(int x, int y, Color c)
            {
                if ((uint)x >= (uint)W || (uint)y >= (uint)H || c.a <= 0f) return;
                int i = y * W + x;
                Color d = Px[i];
                float a = c.a + d.a * (1f - c.a);
                if (a <= 0f) return;
                Px[i] = new Color(
                    (c.r * c.a + d.r * d.a * (1f - c.a)) / a,
                    (c.g * c.a + d.g * d.a * (1f - c.a)) / a,
                    (c.b * c.a + d.b * d.a * (1f - c.a)) / a,
                    a);
            }

            public void BlendRect(float fx, float fy, float fw, float fh, Color c)
            {
                int x0 = Mathf.FloorToInt(fx), y0 = Mathf.FloorToInt(fy);
                int x1 = Mathf.CeilToInt(fx + fw), y1 = Mathf.CeilToInt(fy + fh);
                for (int y = y0; y < y1; y++)
                    for (int x = x0; x < x1; x++)
                        BlendPixel(x, y, c);
            }

            public void BlendCircle(float cx, float cy, float r, Color c)
            {
                int x0 = Mathf.FloorToInt(cx - r), x1 = Mathf.CeilToInt(cx + r);
                int y0 = Mathf.FloorToInt(cy - r), y1 = Mathf.CeilToInt(cy + r);
                for (int y = y0; y <= y1; y++)
                    for (int x = x0; x <= x1; x++)
                    {
                        float d = Mathf.Sqrt((x + 0.5f - cx) * (x + 0.5f - cx) + (y + 0.5f - cy) * (y + 0.5f - cy));
                        float aa = Mathf.Clamp01(r - d + 0.5f);
                        if (aa > 0f)
                        {
                            Color cc = c; cc.a *= aa;
                            BlendPixel(x, y, cc);
                        }
                    }
            }

            public void BlendEllipse(float cx, float cy, float rx, float ry, Color c)
            {
                int x0 = Mathf.FloorToInt(cx - rx), x1 = Mathf.CeilToInt(cx + rx);
                int y0 = Mathf.FloorToInt(cy - ry), y1 = Mathf.CeilToInt(cy + ry);
                for (int y = y0; y <= y1; y++)
                    for (int x = x0; x <= x1; x++)
                    {
                        float dx = (x + 0.5f - cx) / rx, dy = (y + 0.5f - cy) / ry;
                        float d = Mathf.Sqrt(dx * dx + dy * dy);
                        float aa = Mathf.Clamp01((1f - d) * rx + 0.5f);
                        if (aa > 0f)
                        {
                            Color cc = c; cc.a *= aa;
                            BlendPixel(x, y, cc);
                        }
                    }
            }
        }

        /* -------------------------------------------------- texture bakes */

        // Real material albedos, not final pixel colors. These used to be
        // near-black (#12161d asphalt, #152a19 grass) because the renderer
        // was unlit and whatever was written here was what you saw. Under
        // real lighting that multiplies down to nothing, so every surface
        // now carries roughly its true reflectance — asphalt ~0.30,
        // concrete ~0.45, grass ~0.30 — and the sun/ambient supply the mood.
        static readonly Color RoadA = Cfg.Hex("#34383f");
        static readonly Color RoadB = Cfg.Hex("#393d45");
        static readonly Color SideBase = Cfg.Hex("#767b84");
        static readonly Color ParkBase = Cfg.Hex("#3f5a2e");
        static readonly Color ParkPatch = Cfg.Hex("#496639");
        static readonly Color TreeDark = Cfg.Hex("#3d6b3f");
        static readonly Color WaterA = Cfg.Hex("#1e3f55");
        static readonly Color WaterB = Cfg.Hex("#244a63");

        Texture2D GetGroundTex(int bx, int by)
        {
            long key = Key(bx, by);
            Texture2D tex;
            if (groundTexCache.TryGetValue(key, out tex)) return tex;

            int originX = bx * BlockPx - Margin;
            int originY = by * BlockPx - Margin;
            var buf = new PBuf { W = GroundTex, H = GroundTex, Px = new Color32[GroundTex * GroundTex] };

            for (int ty = by * Cfg.BlockTiles - 1; ty <= by * Cfg.BlockTiles + Cfg.BlockTiles; ty++)
            {
                for (int tx = bx * Cfg.BlockTiles - 1; tx <= bx * Cfg.BlockTiles + Cfg.BlockTiles; tx++)
                {
                    int t = CityMap.TileType(tx, ty);
                    Color c;
                    if (t == Cfg.Road) c = JSRng.Hash2(tx, ty) > 0.5 ? RoadA : RoadB;
                    else if (t == Cfg.Side) c = SideBase;
                    else if (t == Cfg.Park) c = ParkBase;
                    else if (t == Cfg.Water) c = JSRng.Hash2(tx * 7, ty * 7) > 0.5 ? WaterA : WaterB;
                    else c = Cfg.Hex("#2b2f36"); // under buildings
                    buf.BlendRect(tx * Cfg.Tile - originX, ty * Cfg.Tile - originY, Cfg.Tile, Cfg.Tile, c);
                }
            }

            for (int ty = by * Cfg.BlockTiles - 1; ty <= by * Cfg.BlockTiles + Cfg.BlockTiles; ty++)
            {
                for (int tx = bx * Cfg.BlockTiles - 1; tx <= bx * Cfg.BlockTiles + Cfg.BlockTiles; tx++)
                {
                    int t = CityMap.TileType(tx, ty);
                    float x = tx * Cfg.Tile - originX, y = ty * Cfg.Tile - originY;
                    int rx = ((tx % Cfg.BlockTiles) + Cfg.BlockTiles) % Cfg.BlockTiles;
                    int ry = ((ty % Cfg.BlockTiles) + Cfg.BlockTiles) % Cfg.BlockTiles;

                    if (t == Cfg.Road)
                    {
                        if (JSRng.Hash2(tx * 5, ty * 13) > 0.85)
                            buf.BlendRect(x + 5 + (float)(JSRng.Hash2(tx, ty * 3) * 14), y + 6 + (float)(JSRng.Hash2(tx * 3, ty) * 14), 20, 13, new Color(0, 0, 0, 0.20f));
                        buf.BlendRect(x + 8 + (float)(JSRng.Hash2(tx * 11, ty * 7) * 26), y + 6 + (float)(JSRng.Hash2(tx, ty * 9) * 30), 5, 3, new Color(1, 1, 1, 0.035f));
                        buf.BlendRect(x + 6 + (float)(JSRng.Hash2(tx * 19, ty * 23) * 28), y + 8 + (float)(JSRng.Hash2(tx * 7, ty * 17) * 28), 4, 3, new Color(1, 1, 1, 0.035f));
                        if (JSRng.Hash2(tx * 17, ty * 19) > 0.955 && rx >= 1 && ry >= 1)
                        {
                            buf.BlendCircle(x + Cfg.Tile / 2f, y + Cfg.Tile / 2f, 5.5f, new Color(1, 1, 1, 0.06f));
                            for (int a = 0; a < 24; a++)
                            {
                                float ang = a * Mathf.PI * 2f / 24f;
                                buf.BlendRect(x + Cfg.Tile / 2f + Mathf.Cos(ang) * 5.5f - 0.5f, y + Cfg.Tile / 2f + Mathf.Sin(ang) * 5.5f - 0.5f, 1, 1, new Color(0, 0, 0, 0.45f));
                            }
                        }
                        // Surface wear. Perfectly uniform asphalt is one of the
                        // clearest CG tells — real roads carry patch repairs,
                        // tyre polish down the wheel tracks, cracks and oil
                        // staining. Hash-driven, so it is stable per tile, and
                        // drawn UNDER the lane markings below since paint goes
                        // on top of worn asphalt.
                        if (JSRng.Hash2(tx * 29, ty * 31) > 0.62)
                        {
                            float pw = 14f + (float)JSRng.Hash2(tx * 37, ty * 41) * 22f;
                            float ph = 10f + (float)JSRng.Hash2(tx * 43, ty * 47) * 20f;
                            float ppx = x + (float)JSRng.Hash2(tx * 53, ty * 59) * (Cfg.Tile - pw);
                            float ppy = y + (float)JSRng.Hash2(tx * 61, ty * 67) * (Cfg.Tile - ph);
                            buf.BlendRect(ppx, ppy, pw, ph, new Color(0.06f, 0.07f, 0.08f, 0.30f));
                            buf.BlendRect(ppx, ppy, pw, 1.5f, new Color(0, 0, 0, 0.25f));
                        }
                        if (rx < 3)
                        {
                            buf.BlendRect(x + Cfg.Tile * 0.22f, y, 6, Cfg.Tile, new Color(0, 0, 0, 0.10f));
                            buf.BlendRect(x + Cfg.Tile * 0.66f, y, 6, Cfg.Tile, new Color(0, 0, 0, 0.10f));
                        }
                        if (ry < 3)
                        {
                            buf.BlendRect(x, y + Cfg.Tile * 0.22f, Cfg.Tile, 6, new Color(0, 0, 0, 0.10f));
                            buf.BlendRect(x, y + Cfg.Tile * 0.66f, Cfg.Tile, 6, new Color(0, 0, 0, 0.10f));
                        }
                        if (JSRng.Hash2(tx * 71, ty * 73) > 0.72)
                        {
                            float ccx = x + 6 + (float)JSRng.Hash2(tx * 79, ty * 83) * (Cfg.Tile - 14);
                            float ccy = y + 4 + (float)JSRng.Hash2(tx * 89, ty * 97) * (Cfg.Tile - 12);
                            int segs = 3 + (int)(JSRng.Hash2(tx * 101, ty * 103) * 4);
                            for (int cseg = 0; cseg < segs; cseg++)
                            {
                                buf.BlendRect(ccx, ccy, 1.2f,
                                              4f + (float)JSRng.Hash2(tx + cseg, ty * 5 + cseg) * 5f,
                                              new Color(0, 0, 0, 0.35f));
                                ccx += ((float)JSRng.Hash2(tx * 3 + cseg, ty * 7 + cseg) - 0.5f) * 5f;
                                ccy += 4f;
                            }
                        }
                        if (JSRng.Hash2(tx * 107, ty * 109) > 0.86)
                            buf.BlendEllipse(x + Cfg.Tile * 0.5f, y + Cfg.Tile * 0.5f, 9f, 6f,
                                             new Color(0, 0, 0, 0.22f));

                        if (rx == 1 && ry >= 3 && ty % 2 == 0)
                            buf.BlendRect(x + Cfg.Tile / 2f - 1, y + 6, 2, Cfg.Tile - 12, new Color(1, 1, 1, 0.13f));
                        if (ry == 1 && rx >= 3 && tx % 2 == 0)
                            buf.BlendRect(x + 6, y + Cfg.Tile / 2f - 1, Cfg.Tile - 12, 2, new Color(1, 1, 1, 0.13f));
                        if ((rx < 3 && (ry == 3 || ry == 9)) || (ry < 3 && (rx == 3 || rx == 9)))
                        {
                            var cw = new Color(1, 1, 1, 0.16f);
                            if (rx < 3) for (int i = 0; i < 4; i++) buf.BlendRect(x + 4 + i * 12, y + 4, 6, Cfg.Tile - 8, cw);
                            else for (int k = 0; k < 4; k++) buf.BlendRect(x + 4, y + 4 + k * 12, Cfg.Tile - 8, 6, cw);
                        }
                        var curb = new Color(1, 1, 1, 0.10f);
                        if (CityMap.TileType(tx, ty - 1) == Cfg.Side) buf.BlendRect(x, y, Cfg.Tile, 2, curb);
                        if (CityMap.TileType(tx, ty + 1) == Cfg.Side) buf.BlendRect(x, y + Cfg.Tile - 2, Cfg.Tile, 2, curb);
                        if (CityMap.TileType(tx - 1, ty) == Cfg.Side) buf.BlendRect(x, y, 2, Cfg.Tile, curb);
                        if (CityMap.TileType(tx + 1, ty) == Cfg.Side) buf.BlendRect(x + Cfg.Tile - 2, y, 2, Cfg.Tile, curb);
                    }
                    else if (t == Cfg.Side)
                    {
                        var joint = new Color(0, 0, 0, 0.28f);
                        buf.BlendRect(x + Cfg.Tile / 2f, y, 1, Cfg.Tile, joint);
                        buf.BlendRect(x, y + Cfg.Tile / 2f, Cfg.Tile, 1, joint);
                        var edge = new Color(1, 1, 1, 0.05f);
                        buf.BlendRect(x, y, Cfg.Tile, 1, edge);
                        buf.BlendRect(x, y + Cfg.Tile - 1, Cfg.Tile, 1, edge);
                        buf.BlendRect(x, y, 1, Cfg.Tile, edge);
                        buf.BlendRect(x + Cfg.Tile - 1, y, 1, Cfg.Tile, edge);

                        bool corner = (rx == 3 || rx == 9) && (ry == 3 || ry == 9);
                        if (!corner && JSRng.Hash2(tx * 5, ty * 5) < 0.12)
                        {
                            // ground shadow under the 3D sidewalk tree
                            buf.BlendEllipse(x + Cfg.Tile / 2f + 3, y + Cfg.Tile / 2f + 4, 12, 6, new Color(0, 0, 0, 0.35f));
                        }
                    }
                    else if (t == Cfg.Park)
                    {
                        if (JSRng.Hash2(tx * 3, ty * 3) > 0.6)
                            buf.BlendRect(x + 8, y + 8, Cfg.Tile - 16, Cfg.Tile - 16, ParkPatch);
                    }
                    else if (t == Cfg.Water)
                    {
                        // a few soft ripple highlights per tile
                        for (int i = 0; i < 2; i++)
                        {
                            float rxp = x + 6 + (float)(JSRng.Hash2(tx * 13 + i, ty * 17 + i) * (Cfg.Tile - 20));
                            float ryp = y + 6 + (float)(JSRng.Hash2(tx * 19 + i, ty * 23 + i) * (Cfg.Tile - 20));
                            buf.BlendRect(rxp, ryp, 12 + i * 4, 2, new Color(1, 1, 1, 0.05f));
                        }
                    }
                }
            }

            double bh = JSRng.BlockHash(bx, by);
            if (bh < 0.16)
            {
                // park tree ground shadows (trees themselves are 3D now)
                float x0 = (bx * Cfg.BlockTiles + 4) * Cfg.Tile - originX;
                float y0 = (by * Cfg.BlockTiles + 4) * Cfg.Tile - originY;
                float w = 5 * Cfg.Tile, h = 5 * Cfg.Tile;
                for (int i = 0; i < 6; i++)
                {
                    double th = JSRng.Hash2(bx * 31 + i, by * 17 + i);
                    float px = x0 + 20 + (float)(th * (w - 40));
                    float py = y0 + 20 + (float)(JSRng.Hash2(bx * 13 + i, by * 29 + i) * (h - 40));
                    buf.BlendEllipse(px + 3, py + 4, 14, 8, new Color(0, 0, 0, 0.35f));
                }
            }

            // Phase 9: mip chain + anisotropy. The ground is the most
            // grazing-angle surface in the game — the chase cam looks down a
            // road for hundreds of units — so an unmipped 576px block texture
            // crawls and sparkles a few blocks out. Mips alone would smear
            // the road markings away at that angle; aniso 8 is what keeps
            // them legible. Costs ~33% more texture memory per cached block.
            tex = new Texture2D(GroundTex, GroundTex, TextureFormat.RGBA32, true);
            tex.wrapMode = TextureWrapMode.Clamp;
            tex.filterMode = FilterMode.Bilinear;
            tex.anisoLevel = 8;
            tex.SetPixels32(buf.Px);
            tex.Apply(true, true);
            groundTexCache[key] = tex;
            return tex;
        }

        Texture2D GetRoofTex(int bx, int by)
        {
            long key = Key(bx, by);
            Texture2D tex;
            if (roofTexCache.TryGetValue(key, out tex)) return tex;

            double bh = JSRng.BlockHash(bx, by);
            int district = District(bx, by);
            var buf = new PBuf { W = RoofTex, H = RoofTex, Px = new Color32[RoofTex * RoofTex] };
            int w = RoofTex, h = RoofTex;

            Color pal = Cfg.RoofPalette[Mathf.Min(Cfg.RoofPalette.Length - 1, (int)(bh * Cfg.RoofPalette.Length))];
            if (district == Residential) pal = Color.Lerp(pal, Cfg.Hex("#6d5a3f"), 0.35f);       // warm terracotta tint
            else if (district == Industrial) pal = Color.Lerp(pal, Cfg.Hex("#4b5058"), 0.5f);     // flat gray-slate
            buf.BlendRect(0, 0, w, h, pal);

            var line = new Color(1, 1, 1, 0.07f);
            buf.BlendRect(6.5f, 6.5f, w - 13, 1, line);
            buf.BlendRect(6.5f, h - 7.5f, w - 13, 1, line);
            buf.BlendRect(6.5f, 6.5f, 1, h - 13, line);
            buf.BlendRect(w - 7.5f, 6.5f, 1, h - 13, line);

            int n = 2 + (int)(bh * 3);
            for (int q = 0; q < n; q++)
            {
                float qx = 16 + (float)(JSRng.Hash2(bx * 7 + q, by * 5 + q) * (w - 56));
                float qy = 16 + (float)(JSRng.Hash2(bx * 3 + q, by * 11 + q) * (h - 56));
                buf.BlendRect(qx + 2, qy + 3, 22, 16, new Color(0, 0, 0, 0.30f));
                buf.BlendRect(qx, qy, 22, 16, Cfg.Hex("#4d5666"));
                buf.BlendRect(qx + 3, qy + 3, 16, 4, new Color(1, 1, 1, 0.08f));
            }

            if (bh > 0.82)
            {
                Color neon = bh > 0.9 ? new Color(79f / 255f, 180f / 255f, 1f, 0.75f)
                                      : new Color(1f, 178f / 255f, 36f / 255f, 0.75f);
                Color glowC = neon; glowC.a = 0.10f;
                buf.BlendRect(10, h - 16, w - 20, 20, glowC);
                buf.BlendRect(14, h - 6, w - 28, 3, neon);
            }

            // Phase 9: mips + aniso, same reasoning as the ground texture.
            // Roofs are seen from a low chase cam across the whole skyline,
            // so they sit at grazing angles almost permanently.
            tex = new Texture2D(RoofTex, RoofTex, TextureFormat.RGBA32, true);
            tex.wrapMode = TextureWrapMode.Clamp;
            tex.filterMode = FilterMode.Bilinear;
            tex.anisoLevel = 8;
            tex.SetPixels32(buf.Px);
            tex.Apply(true, true);
            roofTexCache[key] = tex;
            return tex;
        }

        // Ground-floor shopfront. Unlike the wall texture this fits its band
        // exactly once vertically (MeshKit.BoxMeshUV), so it has a real bottom
        // and top: plinth at the pavement, glazed bays with a doorway, a lit
        // sign strip, then a cornice where the tower takes over. Row 0 of the
        // pixel buffer is the BOTTOM of the texture, so low y is street level.
        Texture2D BakeShopTex(int variant)
        {
            const int S = 128;
            var buf = new PBuf { W = S, H = S, Px = new Color32[S * S] };
            Color stone = Cfg.Hex(variant % 2 == 0 ? "#5c626b" : "#666c75");
            buf.BlendRect(0, 0, S, S, stone);

            buf.BlendRect(0, 0, S, 10, Cfg.Hex("#3e434a"));      // plinth

            for (int bay = 0; bay < 2; bay++)
            {
                float x0 = bay * 64f + 5f;
                // glazing, lit from inside — bright enough to glow after dark
                Color glass = (variant + bay) % 2 == 0
                    ? new Color(1f, 0.90f, 0.66f, 1f)      // warm interior
                    : new Color(0.78f, 0.88f, 1f, 1f);     // cool / fluorescent
                buf.BlendRect(x0, 11, 40, 62, glass);
                buf.BlendRect(x0 + 13, 11, 2.5f, 62, new Color(0, 0, 0, 0.55f));   // mullion
                buf.BlendRect(x0 + 26, 11, 2.5f, 62, new Color(0, 0, 0, 0.55f));
                buf.BlendRect(x0 + 44, 11, 14, 52, Cfg.Hex("#2b3038"));            // doorway
                buf.BlendRect(x0 - 2, 9, 62, 2.5f, Cfg.Hex("#2f343b"));            // frame
                buf.BlendRect(x0 - 2, 73, 62, 3f, Cfg.Hex("#2f343b"));
            }

            // Signage: one board per shop bay, set into a dark fascia, rather
            // than a single lit strip spanning the whole facade. An unbroken
            // glowing band across every building reads as a neon tube — a
            // street of separate businesses needs gaps and uneven widths.
            buf.BlendRect(0, 86, S, 2, new Color(0, 0, 0, 0.45f));
            buf.BlendRect(0, 88, S, 18, Cfg.Hex("#3a3f47"));     // dark fascia
            for (int bay = 0; bay < 2; bay++)
            {
                Color sign = SignColors[(variant * 2 + bay) % SignColors.Length];
                float sw = bay == 0 ? 42f : 33f;                 // deliberately uneven
                float sx0 = bay * 64f + (bay == 0 ? 7f : 14f);
                buf.BlendRect(sx0, 91.5f, sw, 12f, sign);
                buf.BlendRect(sx0 - 1.5f, 90f, sw + 3f, 1.5f, new Color(0, 0, 0, 0.40f));
                buf.BlendRect(sx0 - 1.5f, 103.5f, sw + 3f, 1.5f, new Color(0, 0, 0, 0.40f));
            }

            buf.BlendRect(0, 108, S, 5, Cfg.Hex("#4b515a"));     // cornice
            buf.BlendRect(0, 113, S, 2, new Color(0, 0, 0, 0.35f));

            // Phase 9: mips + bilinear + aniso. Point filtering was a holdover
            // from the unlit pixel-art era; on a shopfront band seen down a
            // street it aliases the mullions into flicker. Bilinear softens
            // the 128px source slightly at close range — an accepted trade
            // for a stable image at every other distance.
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true);
            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Bilinear;
            tex.anisoLevel = 8;
            tex.SetPixels32(buf.Px);
            tex.Apply(true, true);
            return tex;
        }

        // 64x64 tiling wall texture: 4x4 window cells, some lit warm/cool.
        // One texture repeat spans 192 world px (window every 48px tile).
        Texture2D BakeWallTex(int variant)
        {
            // 128px with the same 16px cell = 8x8 windows per texture repeat
            // instead of 4x4. One repeat spans 192 world units, so windows
            // are ~24 units across rather than a storey-high 48 — at 4x4
            // they read as glowing slabs rather than windows.
            const int S = 128, Cell = 16;
            var buf = new PBuf { W = S, H = S, Px = new Color32[S * S] };
            // concrete/stone albedo (~0.42), not the near-black the unlit
            // renderer needed. Kept well below the shader's emissive
            // luminance threshold so the wall itself never glows — only
            // the lit window panes below do.
            Color wall = Cfg.Hex(variant % 2 == 0 ? "#6d727b" : "#63686f");
            buf.BlendRect(0, 0, S, S, wall);

            for (int cy = 0; cy < S / Cell; cy++)
            {
                for (int cx = 0; cx < S / Cell; cx++)
                {
                    // The city is night-locked, so a majority of windows are
                    // lit — an occupied skyline after dark is most of what
                    // makes the city read at night. Most are warm (homes and
                    // offices), a minority cool/fluorescent.
                    const double LitWindow = 0.42;
                    double r = JSRng.Hash2(variant * 97 + cx * 13, cy * 29 + variant * 7);
                    // window frame + pane
                    float wx = cx * Cell + 4, wy = cy * Cell + 3;
                    buf.BlendRect(wx - 1, wy - 1, 10, 12, new Color(0, 0, 0, 0.5f));
                    Color pane;
                    bool lit = r > LitWindow;
                    if (lit)
                        // bright enough to clear the shader's emissive
                        // luminance threshold, so these glow after dark
                        pane = r > 0.9 ? new Color(0.72f, 0.85f, 1f, 0.85f)      // cool light
                                       : new Color(1f, 0.87f, 0.60f, 0.9f);      // warm light
                    else
                        // unlit glazing reflecting the sky, not a black hole
                        pane = new Color(0.16f, 0.19f, 0.24f, 1f);               // dark
                    buf.BlendRect(wx, wy, 8, 10, pane);
                    if (lit) buf.BlendRect(wx, wy + 4, 8, 1, new Color(0, 0, 0, 0.25f)); // sash
                }
            }

            // Phase 9: mips + bilinear + aniso. This is the worst offender in
            // the whole frame — an 8x8 window grid tiled up a 1400-unit tower,
            // point-sampled with no mips, sparkles violently at distance. The
            // deep mips average whole window rows into flat grey, which is
            // correct: that is what a tower looks like from half a mile away.
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true);
            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Bilinear;
            tex.anisoLevel = 8;
            tex.SetPixels32(buf.Px);
            tex.Apply(true, true);
            return tex;
        }

        /* ---------------------------------------------- Phase 11 heights */

        // Height field for BakeWallTex, same 128px grid and same 16px cell so
        // every feature lands on the pixel its albedo counterpart does.
        //
        // Deliberately NOT derived from albedo luminance: the bright texels in
        // the wall texture are the LIT WINDOWS, so a luminance-derived height
        // would emboss lit windows outward and leave dark ones flat — every
        // window on the building bulging or sinking according to whether
        // someone is home. Modelling the masonry explicitly avoids that.
        Texture2D BakeWallHeight(int variant)
        {
            const int S = 128, Cell = 16;
            var buf = new PBuf { W = S, H = S, Px = new Color32[S * S] };

            const float WallPlane = 0.55f;   // the concrete face, mid-grey
            const float Reveal    = 0.78f;   // frame standing proud of it
            const float Pane      = 0.10f;   // glass set deep into the reveal

            buf.BlendRect(0, 0, S, S, Gray(WallPlane));

            for (int cy = 0; cy < S / Cell; cy++)
            {
                for (int cx = 0; cx < S / Cell; cx++)
                {
                    float wx = cx * Cell + 4, wy = cy * Cell + 3;
                    buf.BlendRect(wx - 1, wy - 1, 10, 12, Gray(Reveal));
                    buf.BlendRect(wx, wy, 8, 10, Gray(Pane));
                }
            }

            return HeightTex(buf, S);
        }

        // Height field for BakeShopTex. Same geometry constants as the albedo
        // bake — plinth and cornice proud, glazing and doorway recessed,
        // mullions standing back out of the glass.
        Texture2D BakeShopHeight(int variant)
        {
            const int S = 128;
            var buf = new PBuf { W = S, H = S, Px = new Color32[S * S] };

            buf.BlendRect(0, 0, S, S, Gray(0.55f));      // stone face
            buf.BlendRect(0, 0, S, 10, Gray(0.80f));     // plinth, proud

            for (int bay = 0; bay < 2; bay++)
            {
                float x0 = bay * 64f + 5f;
                buf.BlendRect(x0, 11, 40, 62, Gray(0.12f));            // glazing, deep
                buf.BlendRect(x0 + 13, 11, 2.5f, 62, Gray(0.66f));     // mullion
                buf.BlendRect(x0 + 26, 11, 2.5f, 62, Gray(0.66f));
                buf.BlendRect(x0 + 44, 11, 14, 52, Gray(0.06f));       // doorway, deeper
                buf.BlendRect(x0 - 2, 9, 62, 2.5f, Gray(0.76f));       // frame
                buf.BlendRect(x0 - 2, 73, 62, 3f, Gray(0.76f));
            }

            buf.BlendRect(0, 86, S, 2, Gray(0.60f));
            buf.BlendRect(0, 88, S, 18, Gray(0.70f));    // fascia
            for (int bay = 0; bay < 2; bay++)
            {
                float sw = bay == 0 ? 42f : 33f;
                float sx0 = bay * 64f + (bay == 0 ? 7f : 14f);
                buf.BlendRect(sx0, 91.5f, sw, 12f, Gray(0.86f));       // sign board
            }

            buf.BlendRect(0, 108, S, 5, Gray(0.94f));    // cornice, proudest
            buf.BlendRect(0, 113, S, 2, Gray(0.62f));

            return HeightTex(buf, S);
        }

        static Color Gray(float v) { return new Color(v, v, v, 1f); }

        // Height maps are data, not colour: built linear so the shader's
        // gradient is of the authored value and not of an sRGB-decoded one.
        // Mips are on for the same reason they are on the albedo — without
        // them the perturbed normal aliases at distance, which is far more
        // visible than albedo aliasing because it makes surfaces flicker
        // between lit and unlit.
        static Texture2D HeightTex(PBuf buf, int S)
        {
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true, true);
            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Bilinear;
            tex.anisoLevel = 8;
            tex.SetPixels32(buf.Px);
            tex.Apply(true, true);
            return tex;
        }
    }
}
