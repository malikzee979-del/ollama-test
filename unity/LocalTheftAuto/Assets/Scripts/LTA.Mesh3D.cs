/* ==========================================================================
   Local Theft Auto — 3D mesh kit for the Vice-City-style renderer.
   The simulation runs in the original 2D JS space (x right, y DOWN, pixels);
   this maps it into 3D: X = x, Z = -y, Y = up. Everything is unlit
   (LTA/Opaque) with "lighting" baked into vertex colors from face normals.

   Cars come in three body types (sedan / compact hatch / van), lofted from
   side profiles with chamfered flanks, two-tone skirts, inset glass with
   pillars, wheel wells, cylindrical wheels (spun by the sync pass),
   bumpers, grille and plates. Pedestrians have human proportions with
   jacket / cap / skirt variants.
   ========================================================================== */
using System.Collections.Generic;
using UnityEngine;

namespace LocalTheftAuto
{
    public static class MeshKit
    {
        /* -------------------------------------------------- space mapping */

        public static Vector3 V3(float xJs, float yJs, float h)
        {
            return new Vector3(xJs, h, -yJs);
        }

        public static Quaternion YawJs(float aJs)
        {
            return Quaternion.LookRotation(new Vector3(Mathf.Cos(aJs), 0f, Mathf.Sin(aJs) * -1f), Vector3.up);
        }

        /* ------------------------------------------------------ materials */

        static Shader shader;
        static Material white;
        static readonly Dictionary<Texture, Material> texMats = new Dictionary<Texture, Material>();
        static MaterialPropertyBlock mpb;

        public static void Init()
        {
            if (shader != null) return;
            SpriteKit.Init();
            shader = Resources.Load<Shader>("LTA-Lit");
            white = new Material(shader) { mainTexture = SpriteKit.WhiteTex };
            mpb = new MaterialPropertyBlock();
        }

        public static Material White { get { Init(); return white; } }

        // Self-lit material for things that ARE light sources at night —
        // lamp heads, neon, sirens. Deliberately separate from White: the
        // emissive term keys off albedo luminance, so putting it on the
        // shared material would make every bright-painted car and shirt
        // glow too.
        static Material emissive;
        public static Material Emissive
        {
            get
            {
                Init();
                if (emissive == null)
                {
                    emissive = new Material(shader) { mainTexture = SpriteKit.WhiteTex };
                    // kept moderate: at 2.4 lamp heads clipped to flat white
                    // blobs and lost their warm color entirely
                    emissive.SetFloat("_EmissStrength", 1.35f);
                    emissive.SetFloat("_EmissThreshold", 0.5f);
                }
                return emissive;
            }
        }

        // Glossy "clearcoat" for painted car shells. ONE shared material for
        // every car: the paint colour arrives via the vertex colours baked in
        // CarBodyMesh plus Tint()'s MaterialPropertyBlock, so no per-car
        // Material instances are ever created (keeps batching intact and
        // leaks nothing). High gloss and a raised specular so the bodies
        // catch the street lamps and headlights — the city is night-locked
        // and those are real lights now. _EmissThreshold/_EmissStrength stay
        // at their defaults on purpose: paint must not glow (that is what the
        // separate Emissive material is for).
        static Material carPaint;
        public static Material CarPaint
        {
            get
            {
                Init();
                if (carPaint == null)
                {
                    carPaint = new Material(shader) { mainTexture = CarBodyTex() };
                    carPaint.SetFloat("_Gloss", 0.82f);        // White sits at 0.12: this is the clearcoat sheen
                    carPaint.SetFloat("_SpecStrength", 1.35f);  // lively under lamps, short of chrome (~2.5+)
                    // Phase 10: the only non-zero _Metallic in the game.
                    // Real car paint is a dielectric clearcoat over metallic
                    // flake; 0.25 tints the Fresnel F0 toward the paint colour
                    // so a red car throws a red highlight under a lamp instead
                    // of a white one, without going full chrome.
                    carPaint.SetFloat("_Metallic", 0.25f);
                }
                return carPaint;
            }
        }

        public static Material Mat(Texture tex)
        {
            Init();
            Material m;
            if (!texMats.TryGetValue(tex, out m))
            {
                m = new Material(shader) { mainTexture = tex };
                texMats[tex] = m;
            }
            return m;
        }

        // Realism pass: a glossier, darker sibling of Mat(tex) for wet
        // ground — CityRenderer swaps a block's sharedMaterial between the
        // two while it's raining. Kept as a second cached Material per
        // texture (not a shader-global flag) so it costs zero shader edits
        // and swaps for free through Unity's normal material batching.
        static readonly Dictionary<Texture, Material> wetTexMats = new Dictionary<Texture, Material>();
        public static Material WetMat(Texture tex)
        {
            Init();
            Material m;
            if (!wetTexMats.TryGetValue(tex, out m))
            {
                m = new Material(shader) { mainTexture = tex };
                m.SetFloat("_Gloss", Cfg.WetGloss);
                m.SetFloat("_SpecStrength", Cfg.WetSpecStrength);
                m.SetColor("_Color", new Color(Cfg.WetAlbedoDarken, Cfg.WetAlbedoDarken, Cfg.WetAlbedoDarken, 1f));
                wetTexMats[tex] = m;
            }
            return m;
        }

        // Streaming support (CityRenderer.EvictFarBlocks): drop and destroy the
        // cached dry AND wet materials for a texture that is about to be
        // destroyed. Both dictionaries are keyed on the Texture object itself,
        // so without this the entry survives the texture — a strong reference
        // to a dead Texture2D held forever, and the Material leaks with it.
        //
        // Must be called BEFORE Object.Destroy(tex), while the key is still a
        // live reference and still hashes. Call it after and the lookup can
        // miss, silently leaking the pair.
        //
        // Only ever called with per-block ground/roof textures. The shared
        // wallTex/shopTex arrays are built in CityRenderer.Init() and assigned
        // to their own wallMat/shopMat directly, never routed through Mat() or
        // WetMat(), so they are not in these dictionaries and cannot be
        // released from here by accident.
        public static void ReleaseMat(Texture tex)
        {
            if (tex == null) return;
            Material m;
            if (texMats.TryGetValue(tex, out m))
            {
                texMats.Remove(tex);
                if (m != null) UnityEngine.Object.Destroy(m);
            }
            if (wetTexMats.TryGetValue(tex, out m))
            {
                wetTexMats.Remove(tex);
                if (m != null) UnityEngine.Object.Destroy(m);
            }
        }

        public static void Tint(MeshRenderer mr, Color c)
        {
            mpb.SetColor("_Color", c);
            mr.SetPropertyBlock(mpb);
        }

        /* ---------------------------------------- car body detail texture */

        // Tiling panel detail for painted car shells, baked as a LIGHT
        // MULTIPLIER: mostly pure white with darker shut lines and creases.
        // Final albedo is texel * vertex colour * _Color, and the vertex
        // colour IS the paint — anything dark or tinted here would stain
        // every car (a black car multiplied toward gray, a white car
        // dulled). Row 0 and column 0 stay pure white on purpose: faces
        // that get no UVs (glass overlays, floor) sample (0,0) and keep
        // their flat colour.
        static Texture2D carBodyTex;
        static Texture2D CarBodyTex()
        {
            if (carBodyTex != null) return carBodyTex;
            const int S = 128;   // one repeat covers CarTexTile world units
            var px = new Color32[S * S];
            for (int i = 0; i < px.Length; i++) px[i] = new Color32(255, 255, 255, 255);

            // rocker shadow: faint darkening toward the tile bottom, which
            // lands on the skirt / lower flank in the UV layout below
            // (row 0 stays white — see note above)
            for (int y = 1; y <= 11; y++)
            {
                byte v = (byte)Mathf.RoundToInt(255f * (1f - 0.065f * (1f - (y - 1) / 10f)));
                for (int x = 0; x < S; x++) px[y * S + x] = new Color32(v, v, v, 255);
            }

            // beltline crease — with v scaled by height/CarTexTile this lands
            // ~2.8 world units above each flank quad's v=0 base, i.e. just
            // under the side windows
            BodyTexLineH(px, S, 45f, 1.0f, 0.12f);
            // panel shut lines: a firm main seam plus a fainter second one,
            // both vertical so they run down the flanks as panel gaps
            BodyTexLineV(px, S, 51f, 1.0f, 0.42f);
            BodyTexLineV(px, S, 110f, 0.75f, 0.20f);

            // tiling texture viewed at shallow angles along the flanks, so
            // unlike the clamped city textures this one keeps a mip chain
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true);
            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Bilinear;
            // Phase 9: raised 3 -> 8 to match the city textures. Car flanks
            // are viewed edge-on from the chase cam more often than anything
            // else in the frame, so this is the surface aniso helps most.
            tex.anisoLevel = 8;
            tex.SetPixels32(px);
            tex.Apply(true, true);
            carBodyTex = tex;
            return tex;
        }

        // Soft multiplicative vertical line (panel shut seam) into the car
        // body buffer: gray = 1 - strength at the core, ~1px feathered edge.
        static void BodyTexLineV(Color32[] px, int S, float x, float halfW, float strength)
        {
            int x0 = Mathf.Max(0, Mathf.FloorToInt(x - halfW - 1f));
            int x1 = Mathf.Min(S - 1, Mathf.CeilToInt(x + halfW + 1f));
            for (int xi = x0; xi <= x1; xi++)
            {
                float a = Mathf.Clamp01(halfW + 0.5f - Mathf.Abs(xi + 0.5f - x)) * strength;
                if (a <= 0f) continue;
                byte v = (byte)Mathf.RoundToInt(255f * (1f - a));
                for (int y = 0; y < S; y++) px[y * S + xi] = new Color32(v, v, v, 255);
            }
        }

        // Same, but horizontal (body crease).
        static void BodyTexLineH(Color32[] px, int S, float y, float halfW, float strength)
        {
            int y0 = Mathf.Max(0, Mathf.FloorToInt(y - halfW - 1f));
            int y1 = Mathf.Min(S - 1, Mathf.CeilToInt(y + halfW + 1f));
            for (int yi = y0; yi <= y1; yi++)
            {
                float a = Mathf.Clamp01(halfW + 0.5f - Mathf.Abs(yi + 0.5f - y)) * strength;
                if (a <= 0f) continue;
                byte v = (byte)Mathf.RoundToInt(255f * (1f - a));
                for (int x = 0; x < S; x++) px[yi * S + x] = new Color32(v, v, v, 255);
            }
        }

        /* --------------------------------------------------- mesh builder */

        // NOTE: lighting used to be faked here — every face's vertex color
        // was multiplied by a fixed brightness derived from its normal
        // (the old Shade() helper) because the shader was unlit. That is
        // gone: vertex color is now pure albedo, real per-face normals are
        // written into the mesh, and LTA/Lit does actual diffuse +
        // specular + shadowing against a real directional sun. The old
        // "top faces brighter" cue is now the shader's hemisphere ambient
        // term, which composes correctly with the sun instead of fighting it.
        class MB
        {
            public readonly List<Vector3> V = new List<Vector3>();
            public readonly List<Vector3> N = new List<Vector3>();
            public readonly List<Color> C = new List<Color>();
            public readonly List<Vector2> UV = new List<Vector2>();
            public readonly List<int> T = new List<int>();

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color col, Vector2? uvScale = null)
            {
                Vector3 n = Vector3.Cross(c - a, b - a).normalized;
                // Linear color space: mesh vertex colors are the ONE color path
                // Unity does not convert for you. Textures marked sRGB and
                // material Color properties are converted on read; values handed
                // to Mesh.SetColors reach the shader exactly as written. Every
                // albedo in this project is authored as an sRGB hex string via
                // Cfg.Hex, so without .linear the whole city would be shaded as
                // though sRGB 0.5 meant linear 0.5 — washed out and too bright.
                Color cc = col.linear; cc.a = 1f;
                int i = V.Count;
                V.Add(a); V.Add(b); V.Add(c); V.Add(d);
                Vector2 s = uvScale ?? Vector2.zero;
                UV.Add(new Vector2(0, 0)); UV.Add(new Vector2(s.x, 0));
                UV.Add(new Vector2(s.x, s.y)); UV.Add(new Vector2(0, s.y));
                for (int k = 0; k < 4; k++) { C.Add(cc); N.Add(n); }
                T.Add(i); T.Add(i + 2); T.Add(i + 1);
                T.Add(i); T.Add(i + 3); T.Add(i + 2);
            }

            public void Tri(Vector3 a, Vector3 b, Vector3 c, Color col)
            {
                Vector3 n = Vector3.Cross(c - a, b - a).normalized;
                // sRGB -> linear, same reasoning as Quad() above.
                Color cc = col.linear; cc.a = 1f;
                int i = V.Count;
                V.Add(a); V.Add(b); V.Add(c);
                for (int k = 0; k < 3; k++) { C.Add(cc); UV.Add(Vector2.zero); N.Add(n); }
                T.Add(i); T.Add(i + 2); T.Add(i + 1);
            }

            public Mesh Build()
            {
                var m = new Mesh();
                m.SetVertices(V); m.SetColors(C); m.SetUVs(0, UV);
                m.SetNormals(N);
                m.SetTriangles(T, 0);
                m.RecalculateBounds();
                return m;
            }
        }

        static void AddTaperBox(MB mb, float bx, float bz, float tx, float tz, float h, Vector3 o, Color col)
        {
            float bhx = bx / 2f, bhz = bz / 2f, thx = tx / 2f, thz = tz / 2f;
            mb.Quad(o + new Vector3(bhx, 0, bhz), o + new Vector3(-bhx, 0, bhz), o + new Vector3(-thx, h, thz), o + new Vector3(thx, h, thz), col);
            mb.Quad(o + new Vector3(-bhx, 0, -bhz), o + new Vector3(bhx, 0, -bhz), o + new Vector3(thx, h, -thz), o + new Vector3(-thx, h, -thz), col);
            mb.Quad(o + new Vector3(bhx, 0, -bhz), o + new Vector3(bhx, 0, bhz), o + new Vector3(thx, h, thz), o + new Vector3(thx, h, -thz), col);
            mb.Quad(o + new Vector3(-bhx, 0, bhz), o + new Vector3(-bhx, 0, -bhz), o + new Vector3(-thx, h, -thz), o + new Vector3(-thx, h, thz), col);
            mb.Quad(o + new Vector3(-thx, h, -thz), o + new Vector3(thx, h, -thz), o + new Vector3(thx, h, thz), o + new Vector3(-thx, h, thz), col);
            mb.Quad(o + new Vector3(-bhx, 0, bhz), o + new Vector3(bhx, 0, bhz), o + new Vector3(bhx, 0, -bhz), o + new Vector3(-bhx, 0, -bhz), col);
        }

        // N-sided tapered prism (octagon at sides=8 etc.) — same idea as
        // AddTaperBox but rounder, so limbs/torso read as sculpted flesh
        // instead of a plank with square corners. Faces and both caps are
        // built with the exact winding AddTaperBox already proved correct
        // (side quads walk corners in increasing angle order; the top-cap
        // fan matches Quad's own (a,c,b)/(a,d,c) triangulation, the
        // bottom-cap fan is its mirror).
        static void AddTaperPrism(MB mb, int sides, float bw, float bd, float tw, float td, float h, Vector3 o, Color col)
        {
            var bpts = new Vector3[sides];
            var tpts = new Vector3[sides];
            for (int i = 0; i < sides; i++)
            {
                float ang = Mathf.PI * 2f * i / sides;
                float cx = Mathf.Cos(ang), cz = Mathf.Sin(ang);
                bpts[i] = o + new Vector3(cx * bw * 0.5f, 0f, cz * bd * 0.5f);
                tpts[i] = o + new Vector3(cx * tw * 0.5f, h, cz * td * 0.5f);
            }
            for (int i = 0; i < sides; i++)
            {
                int j = (i + 1) % sides;
                mb.Quad(bpts[i], bpts[j], tpts[j], tpts[i], col);
            }
            for (int i = 1; i < sides - 1; i++)
            {
                mb.Tri(tpts[0], tpts[i + 1], tpts[i], col);
                mb.Tri(bpts[0], bpts[i], bpts[i + 1], col);
            }
        }

        // Small uniform-color joint ball (reuses the head sphere lattice
        // with a single color) — hides the seam where two rigid limb
        // segments meet at a fixed bend angle, e.g. shoulders/elbows/knees.
        static Mesh JointBall(float r, Color col) { return HeadMesh(r, col, col); }

        public static Mesh BoxMesh(float sx, float sy, float sz, Color col, float uvPerWorld = 0f)
        {
            if (uvPerWorld <= 0f)
            {
                var mbPlain = new MB();
                AddTaperBox(mbPlain, sx, sz, sx, sz, sy, Vector3.zero, col);
                return mbPlain.Build();
            }
            var mb = new MB();
            float hx = sx / 2f, hz = sz / 2f;
            var ux = new Vector2(sx * uvPerWorld, sy * uvPerWorld);
            var uz = new Vector2(sz * uvPerWorld, sy * uvPerWorld);
            mb.Quad(new Vector3(hx, 0, hz), new Vector3(-hx, 0, hz), new Vector3(-hx, sy, hz), new Vector3(hx, sy, hz), col, ux);
            mb.Quad(new Vector3(-hx, 0, -hz), new Vector3(hx, 0, -hz), new Vector3(hx, sy, -hz), new Vector3(-hx, sy, -hz), col, ux);
            mb.Quad(new Vector3(hx, 0, -hz), new Vector3(hx, 0, hz), new Vector3(hx, sy, hz), new Vector3(hx, sy, -hz), col, uz);
            mb.Quad(new Vector3(-hx, 0, hz), new Vector3(-hx, 0, -hz), new Vector3(-hx, sy, -hz), new Vector3(-hx, sy, hz), col, uz);
            mb.Quad(new Vector3(-hx, sy, -hz), new Vector3(hx, sy, -hz), new Vector3(hx, sy, hz), new Vector3(-hx, sy, hz), col);
            mb.Quad(new Vector3(-hx, 0, hz), new Vector3(hx, 0, hz), new Vector3(hx, 0, -hz), new Vector3(-hx, 0, -hz), col);
            return mb.Build();
        }

        // True frustum: unlike BoxMesh, top and bottom footprints differ, so
        // the wall itself narrows continuously as it rises — this is what
        // makes a Gotham-style setback tower read as sculpted rather than a
        // stack of flat-sided crates. UVs tile the same way BoxMesh's
        // textured branch does, sized off the average of the two widths so
        // window rows still line up reasonably across the taper.
        public static Mesh TaperBoxMesh(float bx, float bz, float tx, float tz, float h, Color col, float uvPerWorld)
        {
            var mb = new MB();
            float bhx = bx / 2f, bhz = bz / 2f, thx = tx / 2f, thz = tz / 2f;
            var uSide1 = new Vector2((bx + tx) * 0.5f * uvPerWorld, h * uvPerWorld);
            var uSide2 = new Vector2((bz + tz) * 0.5f * uvPerWorld, h * uvPerWorld);
            mb.Quad(new Vector3(bhx, 0, bhz), new Vector3(-bhx, 0, bhz), new Vector3(-thx, h, thz), new Vector3(thx, h, thz), col, uSide1);
            mb.Quad(new Vector3(-bhx, 0, -bhz), new Vector3(bhx, 0, -bhz), new Vector3(thx, h, -thz), new Vector3(-thx, h, -thz), col, uSide1);
            mb.Quad(new Vector3(bhx, 0, -bhz), new Vector3(bhx, 0, bhz), new Vector3(thx, h, thz), new Vector3(thx, h, -thz), col, uSide2);
            mb.Quad(new Vector3(-bhx, 0, bhz), new Vector3(-bhx, 0, -bhz), new Vector3(-thx, h, -thz), new Vector3(-thx, h, thz), col, uSide2);
            mb.Quad(new Vector3(-thx, h, -thz), new Vector3(thx, h, -thz), new Vector3(thx, h, thz), new Vector3(-thx, h, thz), col);
            mb.Quad(new Vector3(-bhx, 0, bhz), new Vector3(bhx, 0, bhz), new Vector3(bhx, 0, -bhz), new Vector3(-bhx, 0, -bhz), col);
            return mb.Build();
        }

        // 4-sided pointed cap (Gothic spire / Art Deco pinnacle roof),
        // sitting base-down on whatever it's parented at. Bottom face is
        // omitted — it always sits flush on a flat roof/ledge underneath.
        public static Mesh PyramidCapMesh(float w, float d, float h, Color col)
        {
            var mb = new MB();
            float hx = w / 2f, hz = d / 2f;
            Vector3 apex = new Vector3(0, h, 0);
            Vector3 pXZ = new Vector3(hx, 0, hz), nXZ = new Vector3(-hx, 0, hz);
            Vector3 pXnZ = new Vector3(hx, 0, -hz), nXnZ = new Vector3(-hx, 0, -hz);
            mb.Tri(pXZ, apex, nXZ, col);
            mb.Tri(nXnZ, apex, pXnZ, col);
            mb.Tri(pXnZ, apex, pXZ, col);
            mb.Tri(nXZ, apex, nXnZ, col);
            return mb.Build();
        }

        // Box whose texture tiles horizontally but fits EXACTLY ONCE up the
        // height. BoxMesh's uvPerWorld scales u and v by the same factor,
        // which is right for a repeating window grid but wrong for anything
        // that has a top and a bottom — a shopfront band needs its plinth at
        // the pavement and its sign under the cornice, at any band height.
        public static Mesh BoxMeshUV(float sx, float sy, float sz, Color col, float uPerWorld, float vTotal)
        {
            var mb = new MB();
            float hx = sx / 2f, hz = sz / 2f;
            var ux = new Vector2(sx * uPerWorld, vTotal);
            var uz = new Vector2(sz * uPerWorld, vTotal);
            mb.Quad(new Vector3(hx, 0, hz), new Vector3(-hx, 0, hz), new Vector3(-hx, sy, hz), new Vector3(hx, sy, hz), col, ux);
            mb.Quad(new Vector3(-hx, 0, -hz), new Vector3(hx, 0, -hz), new Vector3(hx, sy, -hz), new Vector3(-hx, sy, -hz), col, ux);
            mb.Quad(new Vector3(hx, 0, -hz), new Vector3(hx, 0, hz), new Vector3(hx, sy, hz), new Vector3(hx, sy, -hz), col, uz);
            mb.Quad(new Vector3(-hx, 0, hz), new Vector3(-hx, 0, -hz), new Vector3(-hx, sy, -hz), new Vector3(-hx, sy, hz), col, uz);
            mb.Quad(new Vector3(-hx, sy, -hz), new Vector3(hx, sy, -hz), new Vector3(hx, sy, hz), new Vector3(-hx, sy, hz), col);
            mb.Quad(new Vector3(-hx, 0, hz), new Vector3(hx, 0, hz), new Vector3(hx, 0, -hz), new Vector3(-hx, 0, -hz), col);
            return mb.Build();
        }

        public static Mesh QuadMeshXZ(float w, float d, float u0, float v0, float u1, float v1, Color col)
        {
            var m = new Mesh();
            float hx = w / 2f, hz = d / 2f;
            m.SetVertices(new List<Vector3> {
                new Vector3(-hx, 0, -hz), new Vector3(hx, 0, -hz),
                new Vector3(hx, 0, hz), new Vector3(-hx, 0, hz) });
            // sRGB -> linear, same reasoning as MB.Quad() above.
            Color lc = col.linear;
            m.SetColors(new List<Color> { lc, lc, lc, lc });
            m.SetUVs(0, new List<Vector2> {
                new Vector2(u0, v0), new Vector2(u1, v0),
                new Vector2(u1, v1), new Vector2(u0, v1) });
            // flat ground/roof quad — always faces straight up
            m.SetNormals(new List<Vector3> { Vector3.up, Vector3.up, Vector3.up, Vector3.up });
            m.SetTriangles(new[] { 0, 3, 2, 0, 2, 1 }, 0);
            m.RecalculateBounds();
            return m;
        }

        public static MeshRenderer Box(Transform parent, string name, float sx, float sy, float sz,
                                       Vector3 localPos, Color col, float uvPerWorld = 0f, Material mat = null)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = BoxMesh(sx, sy, sz, col, uvPerWorld);
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat != null ? mat : White;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            mr.receiveShadows = true;
            return mr;
        }

        static MeshRenderer MeshGo(Transform parent, string name, Mesh mesh, Vector3 localPos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = White;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            mr.receiveShadows = true;
            return mr;
        }

        public static SpriteRenderer FlatSprite(Transform parent, string name, Sprite spr, Color tint, float y)
        {
            var go = new GameObject(name);
            if (parent != null) go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0f, y, 0f);
            go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = spr;
            sr.color = tint;
            return sr;
        }

        /* -------------------------------------------------------- wheels */

        static Mesh WheelMesh(float r, float w, int seg, Color tire, Color hub)
        {
            var mb = new MB();
            float hw = w / 2f;
            for (int k = 0; k < seg; k++)
            {
                float a0 = k * Mathf.PI * 2f / seg, a1 = (k + 1) * Mathf.PI * 2f / seg;
                var p0 = new Vector3(0, Mathf.Cos(a0) * r, Mathf.Sin(a0) * r);
                var p1 = new Vector3(0, Mathf.Cos(a1) * r, Mathf.Sin(a1) * r);
                mb.Quad(new Vector3(-hw, p0.y, p0.z), new Vector3(hw, p0.y, p0.z),
                        new Vector3(hw, p1.y, p1.z), new Vector3(-hw, p1.y, p1.z), tire);
                mb.Tri(new Vector3(hw, 0, 0), new Vector3(hw, p1.y, p1.z), new Vector3(hw, p0.y, p0.z), tire);
                mb.Tri(new Vector3(-hw, 0, 0), new Vector3(-hw, p0.y, p0.z), new Vector3(-hw, p1.y, p1.z), tire);
                float hr = r * 0.48f;
                var q0 = new Vector3(0, Mathf.Cos(a0) * hr, Mathf.Sin(a0) * hr);
                var q1 = new Vector3(0, Mathf.Cos(a1) * hr, Mathf.Sin(a1) * hr);
                mb.Tri(new Vector3(hw + 0.08f, 0, 0), new Vector3(hw + 0.08f, q1.y, q1.z), new Vector3(hw + 0.08f, q0.y, q0.z), hub);
                mb.Tri(new Vector3(-hw - 0.08f, 0, 0), new Vector3(-hw - 0.08f, q0.y, q0.z), new Vector3(-hw - 0.08f, q1.y, q1.z), hub);
            }
            return mb.Build();
        }

        /* ------------------------------------------------------ car body */

        static readonly Color GlassC = new Color(0.05f, 0.08f, 0.13f);
        static readonly Color HeadlightC = Cfg.Hex("#fff2c8");
        static readonly Color TailDim = new Color(0.55f, 0.10f, 0.10f);
        static readonly Color WheelC = new Color(0.045f, 0.05f, 0.06f);
        static readonly Color HubC = new Color(0.34f, 0.36f, 0.40f);
        static readonly Color BumperC = Cfg.Hex("#3d434d");
        static readonly Color GrilleC = Cfg.Hex("#0e1218");
        static readonly Color PlateC = Cfg.Hex("#b9bfc9");

        // side profiles: rows of { z0, y0, z1, y1 }, front (+z) to back (-z)
        static readonly float[,] SedanProf =
        {
            { 20f,  6.5f,  17f,  8.5f },
            { 17f,  8.5f,   6f,  8.5f },
            {  6f,  8.5f,   1f, 13.2f },
            {  1f, 13.2f,  -8f, 13.2f },
            { -8f, 13.2f, -12f,  8.8f },
            {-12f,  8.8f, -20f,  8.8f },
        };
        static readonly float[,] HatchProf =
        {
            { 17f,  6.3f,  14f,  8.3f },
            { 14f,  8.3f,   4f,  8.3f },
            {  4f,  8.3f,  -1f, 12.9f },
            { -1f, 12.9f,  -9f, 12.9f },
            { -9f, 12.9f, -13f,  7.9f },
            {-13f,  7.9f, -17f,  7.9f },
        };
        static readonly float[,] VanProf =
        {
            { 19f,  7.0f,  16f,  9.2f },
            { 16f,  9.2f,  12f,  9.2f },
            { 12f,  9.2f,   7f, 14.4f },
            {  7f, 14.4f, -15f, 14.4f },
            {-15f, 14.4f, -17f,  9.6f },
            {-17f,  9.6f, -19f,  9.6f },
        };
        // Slice 3: sports — low, short, tapers into a fastback. Shares the
        // BuildCar assembly (wheels/bumpers/lights), so only the silhouette
        // profile is new.
        static readonly float[,] SportsProf =
        {
            { 18f,  5.4f,  14f,  7.2f },
            { 14f,  7.2f,   4f,  7.6f },
            {  4f,  7.6f,  -4f, 10.6f },
            { -4f, 10.6f, -14f,  7.0f },
            {-14f,  7.0f, -18f,  5.6f },
        };
        // Slice 3: truck — long; low high cab up front, flat low bed behind
        // (two distinct deck heights read as "box truck" from the side).
        static readonly float[,] TruckProf =
        {
            { 24f,  7.5f,  20f,  9.8f },
            { 20f,  9.8f,  16f,  9.8f },
            { 16f,  9.8f,  11f, 16.5f },
            { 11f, 16.5f,   4f, 16.5f },
            {  4f, 16.5f,   1f,  8.2f },
            {  1f,  8.2f, -24f,  8.2f },
            {-24f,  8.2f, -26f,  6.8f },
        };

        // FloorY leaves an underbody gap so the wheels show beneath the car;
        // wheels must stay INSIDE SideHx and below the chamfer or they bulge
        // through the body as black patches ("black fenders").
        const float SideHx = 11f, TopHx = 8.5f, Chamfer = 2.2f, FloorY = 4.5f, SkirtY = 5.8f;

        // One repeat of CarBodyTex in world units: small enough that the shut
        // lines inside the tile land near door spacing along a ~40-unit
        // flank, large enough that they stay a crisp 1-2 texels wide at play
        // distance.
        const float CarTexTile = 8f;

        static Mesh CarBodyMesh(Color tint, float[,] prof)
        {
            var mb = new MB();
            int n = prof.GetLength(0);
            Color skirt = tint * 0.55f;

            float roofY = 0f;
            int wsSeg = -1, rgSeg = -1;
            for (int i = 0; i < n; i++)
            {
                roofY = Mathf.Max(roofY, Mathf.Max(prof[i, 1], prof[i, 3]));
                if (wsSeg < 0 && prof[i, 3] > prof[i, 1] + 2f) wsSeg = i;   // rising = windshield
                if (prof[i, 3] < prof[i, 1] - 2f) rgSeg = i;                // falling = rear glass
            }
            float zF = prof[0, 0], zR = prof[n - 1, 2];
            float noseY = prof[0, 1], tailY = prof[n - 1, 3];

            for (int i = 0; i < n; i++)
            {
                float z0 = prof[i, 0], y0 = prof[i, 1], z1 = prof[i, 2], y1 = prof[i, 3];
                // Painted-shell UVs: u runs along the car (one CarBodyTex
                // repeat per CarTexTile world units), v runs up the face.
                // Roof / deck keeps degenerate UVs on purpose — a clean roof
                // reads better than tiling seams, and the (0,0) texel is
                // pure white so it stays flat paint.
                float uLen = Mathf.Abs(z0 - z1) / CarTexTile;
                var uChamfer = new Vector2(uLen, Chamfer / CarTexTile);
                mb.Quad(new Vector3(-TopHx, y1, z1), new Vector3(TopHx, y1, z1),
                        new Vector3(TopHx, y0, z0), new Vector3(-TopHx, y0, z0), tint);
                mb.Quad(new Vector3(-SideHx, y0 - Chamfer, z0), new Vector3(-SideHx, y1 - Chamfer, z1),
                        new Vector3(-TopHx, y1, z1), new Vector3(-TopHx, y0, z0), tint, uChamfer);
                mb.Quad(new Vector3(SideHx, y1 - Chamfer, z1), new Vector3(SideHx, y0 - Chamfer, z0),
                        new Vector3(TopHx, y0, z0), new Vector3(TopHx, y1, z1), tint, uChamfer);

                // flanks with a darker lower skirt where there is room for it.
                // v spans each quad's own height / CarTexTile so the texture
                // features land at consistent world heights up the flank
                float st = Mathf.Min(SkirtY, Mathf.Min(y0, y1) - Chamfer - 0.2f);
                if (st > FloorY + 0.2f)
                {
                    var uSkirt = new Vector2(uLen, (st - FloorY) / CarTexTile);
                    var uUpper = new Vector2(uLen, (Mathf.Max(y0, y1) - Chamfer - st) / CarTexTile);
                    mb.Quad(new Vector3(-SideHx, FloorY, z0), new Vector3(-SideHx, FloorY, z1),
                            new Vector3(-SideHx, st, z1), new Vector3(-SideHx, st, z0), skirt, uSkirt);
                    mb.Quad(new Vector3(-SideHx, st, z0), new Vector3(-SideHx, st, z1),
                            new Vector3(-SideHx, y1 - Chamfer, z1), new Vector3(-SideHx, y0 - Chamfer, z0), tint, uUpper);
                    mb.Quad(new Vector3(SideHx, FloorY, z1), new Vector3(SideHx, FloorY, z0),
                            new Vector3(SideHx, st, z0), new Vector3(SideHx, st, z1), skirt, uSkirt);
                    mb.Quad(new Vector3(SideHx, st, z1), new Vector3(SideHx, st, z0),
                            new Vector3(SideHx, y0 - Chamfer, z0), new Vector3(SideHx, y1 - Chamfer, z1), tint, uUpper);
                }
                else
                {
                    var uFull = new Vector2(uLen, Mathf.Abs(Mathf.Max(y0, y1) - Chamfer - FloorY) / CarTexTile);
                    mb.Quad(new Vector3(-SideHx, FloorY, z0), new Vector3(-SideHx, FloorY, z1),
                            new Vector3(-SideHx, y1 - Chamfer, z1), new Vector3(-SideHx, y0 - Chamfer, z0), tint, uFull);
                    mb.Quad(new Vector3(SideHx, FloorY, z1), new Vector3(SideHx, FloorY, z0),
                            new Vector3(SideHx, y0 - Chamfer, z0), new Vector3(SideHx, y1 - Chamfer, z1), tint, uFull);
                }
            }

            // nose / tail caps: u across the width, v up the face
            float capW = SideHx * 2f / CarTexTile;
            var uNose = new Vector2(capW, Mathf.Max(noseY - Chamfer - FloorY, 0f) / CarTexTile);
            var uNoseTop = new Vector2(capW, Chamfer / CarTexTile);
            var uTail = new Vector2(capW, Mathf.Max(tailY - Chamfer - FloorY, 0f) / CarTexTile);
            var uTailTop = new Vector2(capW, Chamfer / CarTexTile);
            mb.Quad(new Vector3(SideHx, FloorY, zF), new Vector3(-SideHx, FloorY, zF),
                    new Vector3(-SideHx, noseY - Chamfer, zF), new Vector3(SideHx, noseY - Chamfer, zF), tint, uNose);
            mb.Quad(new Vector3(SideHx, noseY - Chamfer, zF), new Vector3(-SideHx, noseY - Chamfer, zF),
                    new Vector3(-TopHx, noseY, zF), new Vector3(TopHx, noseY, zF), tint, uNoseTop);
            mb.Quad(new Vector3(-SideHx, FloorY, zR), new Vector3(SideHx, FloorY, zR),
                    new Vector3(SideHx, tailY - Chamfer, zR), new Vector3(-SideHx, tailY - Chamfer, zR), tint, uTail);
            mb.Quad(new Vector3(-SideHx, tailY - Chamfer, zR), new Vector3(SideHx, tailY - Chamfer, zR),
                    new Vector3(TopHx, tailY, zR), new Vector3(-TopHx, tailY, zR), tint, uTailTop);
            mb.Quad(new Vector3(-SideHx, FloorY, zF), new Vector3(SideHx, FloorY, zF),
                    new Vector3(SideHx, FloorY, zR), new Vector3(-SideHx, FloorY, zR), tint * 0.5f);

            // glass: windshield + rear window overlays, lifted off the slope
            if (wsSeg >= 0) AddGlassOverlay(mb, prof, wsSeg);
            if (rgSeg >= 0) AddGlassOverlay(mb, prof, rgSeg);

            // side windows: two per side with a body-color B-pillar between
            if (wsSeg >= 0 && rgSeg >= 0)
            {
                float zA = prof[wsSeg, 2] - 0.6f;              // behind the A-pillar
                float zB = prof[rgSeg, 0] + 0.6f;              // ahead of the C-pillar
                float zMid = (zA + zB) / 2f;
                float wy0 = roofY - 3.7f, wy1 = roofY - 0.8f;
                SideWindows(mb, zA, zMid + 0.5f, wy0, wy1);
                SideWindows(mb, zMid - 0.5f, zB, wy0, wy1);
            }

            return mb.Build();
        }

        static void SideWindows(MB mb, float zFrontEdge, float zBackEdge, float y0, float y1)
        {
            mb.Quad(new Vector3(SideHx + 0.14f, y0, zBackEdge), new Vector3(SideHx + 0.14f, y0, zFrontEdge),
                    new Vector3(SideHx + 0.14f, y1, zFrontEdge), new Vector3(SideHx + 0.14f, y1, zBackEdge), GlassC * 1.7f);
            mb.Quad(new Vector3(-SideHx - 0.14f, y0, zFrontEdge), new Vector3(-SideHx - 0.14f, y0, zBackEdge),
                    new Vector3(-SideHx - 0.14f, y1, zBackEdge), new Vector3(-SideHx - 0.14f, y1, zFrontEdge), GlassC * 1.7f);
        }

        static void AddGlassOverlay(MB mb, float[,] prof, int seg)
        {
            float z0 = prof[seg, 0], y0 = prof[seg, 1], z1 = prof[seg, 2], y1 = prof[seg, 3];
            float zi0 = Mathf.Lerp(z0, z1, 0.16f), zi1 = Mathf.Lerp(z0, z1, 0.84f);
            float yi0 = Mathf.Lerp(y0, y1, 0.16f) + 0.22f, yi1 = Mathf.Lerp(y0, y1, 0.84f) + 0.22f;
            float w = TopHx - 1.3f;
            mb.Quad(new Vector3(-w, yi1, zi1), new Vector3(w, yi1, zi1),
                    new Vector3(w, yi0, zi0), new Vector3(-w, yi0, zi0), GlassC * 1.7f);
        }

        public static CarVisual BuildCar(Color tint, bool cop, int seed)
        {
            Init();
            var v = new CarVisual();
            v.Root = new GameObject(cop ? "cop" : "car");
            var t = v.Root.transform;
            v.BaseColor = tint;

            // Slice 3: sports/truck take the same NEW seed branches as CarEnt.BodyType
            // (%8==5, %8==6) so mesh and physics keep agreeing for every seed.
            int seedBr = cop ? 0 : (seed & 7);
            float[,] prof = cop ? SedanProf
                : seedBr == 4 ? null   // T11: bike — built by BuildBike below, no car profile
                : seedBr == 5 ? SportsProf
                : seedBr == 6 ? TruckProf
                : (seed % 3 == 0 ? SedanProf : (seed % 3 == 1 ? HatchProf : VanProf));

            if (prof == null)
            {
                BuildBike(v, t, tint, seed);
                return v;
            }

            int pn = prof.GetLength(0);
            float zF = prof[0, 0], zR = prof[pn - 1, 2];
            float roofY = 0f;
            for (int i = 0; i < pn; i++) roofY = Mathf.Max(roofY, Mathf.Max(prof[i, 1], prof[i, 3]));
            float wheelZF = zF - 7f, wheelZR = zR + 7f;

            var sh = FlatSprite(t, "shadow", SpriteKit.Circle, new Color(0, 0, 0, 0.35f), 0.4f);
            sh.transform.localScale = new Vector3((zF - zR + 10f) / 32f, 30f / 32f, 1f);
            sh.transform.localRotation = Quaternion.Euler(90f, 90f, 0f); // long axis along z

            Color bodyC = cop ? Color.white : tint;
            v.Body = MeshGo(t, "body", CarBodyMesh(bodyC, prof), Vector3.zero);
            // glossy painted shell with panel detail; wheels, bumpers, grille,
            // plates, lights and mirrors stay on matte White — rubber and
            // plastic trim shouldn't gleam, and those parts have no UVs
            v.Body.sharedMaterial = CarPaint;

            // wheels sit fully inside the shell, lower halves visible in the
            // underbody gap (no separate "well" boxes — those bulged through
            // the body as black patches)
            var wheel = WheelMesh(3.2f, 3.2f, 10, WheelC, HubC);
            v.Wheels = new Transform[4];
            v.Wheels[0] = MeshGo(t, "wheel-fl", wheel, new Vector3(-8.8f, 3.2f, wheelZF)).transform;
            v.Wheels[1] = MeshGo(t, "wheel-fr", wheel, new Vector3(8.8f, 3.2f, wheelZF)).transform;
            v.Wheels[2] = MeshGo(t, "wheel-rl", wheel, new Vector3(-8.8f, 3.2f, wheelZR)).transform;
            v.Wheels[3] = MeshGo(t, "wheel-rr", wheel, new Vector3(8.8f, 3.2f, wheelZR)).transform;

            // bumpers, grille, plates, lights
            Box(t, "bumper-f", 23f, 2.4f, 2f, new Vector3(0f, 2.1f, zF - 0.2f), BumperC);
            Box(t, "bumper-r", 23f, 2.4f, 2f, new Vector3(0f, 2.1f, zR + 0.2f), BumperC);
            Box(t, "grille", 7.6f, 1.8f, 0.7f, new Vector3(0f, 5.3f, zF + 0.4f), GrilleC);
            Box(t, "plate-f", 5.4f, 1.9f, 0.4f, new Vector3(0f, 3.1f, zF + 0.9f), PlateC);
            Box(t, "plate-r", 5.4f, 1.9f, 0.4f, new Vector3(0f, 3.1f, zR - 0.9f), PlateC);

            Box(t, "head-l", 3.6f, 2.2f, 0.9f, new Vector3(-6.4f, 5.8f, zF + 0.35f), HeadlightC);
            Box(t, "head-r", 3.6f, 2.2f, 0.9f, new Vector3(6.4f, 5.8f, zF + 0.35f), HeadlightC);
            v.BrakeA = Box(t, "tail-l", 3.8f, 2f, 0.9f, new Vector3(-6.8f, 6f, zR - 0.35f), Color.white);
            v.BrakeB = Box(t, "tail-r", 3.8f, 2f, 0.9f, new Vector3(6.8f, 6f, zR - 0.35f), Color.white);
            Tint(v.BrakeA, TailDim);
            Tint(v.BrakeB, TailDim);

            float mirrorZ = wsSegMirrorZ(prof);
            Box(t, "mirror-l", 0.9f, 1.5f, 2.1f, new Vector3(-11.6f, roofY - 3.2f, mirrorZ), Cfg.Hex("#202633"));
            Box(t, "mirror-r", 0.9f, 1.5f, 2.1f, new Vector3(11.6f, roofY - 3.2f, mirrorZ), Cfg.Hex("#202633"));

            // headlight pool on the road ahead
            v.Lights = new GameObject("lights");
            v.Lights.transform.SetParent(t, false);
            var conePivot = new GameObject("cone-pivot");
            conePivot.transform.SetParent(v.Lights.transform, false);
            conePivot.transform.localPosition = new Vector3(0f, 0.5f, 0f);
            conePivot.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var cone = new GameObject("cone");
            cone.transform.SetParent(conePivot.transform, false);
            cone.transform.localPosition = new Vector3(0f, 70f, 0f);
            cone.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            var csr = cone.AddComponent<SpriteRenderer>();
            csr.sprite = SpriteKit.Cone;
            csr.color = Color.white;

            // Real headlight spots, parented under v.Lights so they inherit
            // the existing on/off logic (parked and wrecked cars stay dark).
            // The sprite cone above is kept as the visible beam in the air;
            // these are what actually light the road and the walls it rakes.
            v.Beams = new Light[2];
            for (int hl = 0; hl < 2; hl++)
            {
                var beamGo = new GameObject(hl == 0 ? "beam-l" : "beam-r");
                beamGo.transform.SetParent(v.Lights.transform, false);
                beamGo.transform.localPosition = new Vector3(hl == 0 ? -6.4f : 6.4f, 5.8f, zF);
                beamGo.transform.localRotation = Quaternion.Euler(12f, 0f, 0f);
                var bl = beamGo.AddComponent<Light>();
                bl.type = LightType.Spot;
                bl.color = HeadlightC;
                bl.range = 240f;
                bl.spotAngle = 58f;
                bl.innerSpotAngle = 26f;
                bl.intensity = 6f;
                bl.shadows = LightShadows.None;   // too many cars for shadowed spots
                v.Beams[hl] = bl;
            }

            // Phase 13: the beam you can see in the air, as opposed to the
            // pool it casts on the road (the cone sprite above) and the light
            // it actually contributes (the two spots above that).
            //
            // Two cone sprites crossed at 90 degrees about the forward axis —
            // the standard cheap volumetric fake. From any given angle one of
            // the pair is near edge-on and the other is near face-on, so the
            // shaft keeps some presence as the car turns instead of vanishing
            // the way a single billboard does.
            //
            // Alpha-blended rather than additive on purpose: an additive
            // blend would need a material on a shader outside Resources/, and
            // shader stripping would drop it from a player build. SirenGlow
            // already establishes low-alpha sprites as how this project fakes
            // light bloom, and the Bloom post-FX does the rest.
            if (Cfg.EnableLightShafts)
            {
                v.Shafts = new SpriteRenderer[2];
                var shaftPivot = new GameObject("shaft-pivot");
                shaftPivot.transform.SetParent(v.Lights.transform, false);
                // lifted to headlight height so the shaft leaves the lamp,
                // not the tarmac
                shaftPivot.transform.localPosition = new Vector3(0f, 5.2f, 0f);
                shaftPivot.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
                for (int i = 0; i < 2; i++)
                {
                    var shaftGo = new GameObject(i == 0 ? "shaft-a" : "shaft-b");
                    shaftGo.transform.SetParent(shaftPivot.transform, false);
                    shaftGo.transform.localPosition = new Vector3(0f, 62f, 0f);
                    // pivot's local +Y is world-forward after the Euler(90,0,0)
                    // above, so the middle term rolls each copy about the beam
                    // axis. 45/135 rather than 0/90 keeps neither copy coplanar
                    // with the road pool sprite.
                    shaftGo.transform.localRotation = Quaternion.Euler(0f, 45f + i * 90f, 90f);
                    shaftGo.transform.localScale = new Vector3(0.62f, 1.15f, 1f);
                    var ssr = shaftGo.AddComponent<SpriteRenderer>();
                    ssr.sprite = SpriteKit.Cone;
                    ssr.color = new Color(HeadlightC.r, HeadlightC.g, HeadlightC.b, Cfg.ShaftAlphaBase);
                    v.Shafts[i] = ssr;
                }
            }

            if (cop)
            {
                Box(t, "stripe-l", 0.35f, 3.4f, 26f, new Vector3(-11.1f, 4.6f, -1f), Cfg.Hex("#141821"));
                Box(t, "stripe-r", 0.35f, 3.4f, 26f, new Vector3(11.1f, 4.6f, -1f), Cfg.Hex("#141821"));
                Box(t, "bar-base", 7f, 0.9f, 3.2f, new Vector3(0f, roofY + 0.05f, -3f), Cfg.Hex("#10141c"));
                v.SirenA = Box(t, "siren-a", 3.2f, 2.2f, 3f, new Vector3(-2.2f, roofY + 0.9f, -3f), Color.white);
                v.SirenB = Box(t, "siren-b", 3.2f, 2.2f, 3f, new Vector3(2.2f, roofY + 0.9f, -3f), Color.white);
                var glowGo = new GameObject("siren-glow");
                glowGo.transform.SetParent(t, false);
                glowGo.transform.localPosition = new Vector3(0f, roofY + 9f, -3f);
                v.SirenGlow = glowGo.AddComponent<SpriteRenderer>();
                v.SirenGlow.sprite = SpriteKit.Glow;
                v.SirenGlow.transform.localScale = new Vector3(80f / 128f, 80f / 128f, 1f);
            }
            else
            {
                float len = 0.94f + (Mathf.Abs(seed / 3) % 4) * 0.035f;
                v.Root.transform.localScale = new Vector3(1f, 1f, len);
            }
            return v;
        }

        static float wsSegMirrorZ(float[,] prof)
        {
            for (int i = 0; i < prof.GetLength(0); i++)
                if (prof[i, 3] > prof[i, 1] + 2f) return prof[i, 2] + 1.2f;
            return 3.4f;
        }

        /* ---------------------------------------------------- motorbike (T11) */

        // Built when BuildCar's seed branch is (seed & 7) == 4. Deliberately
        // NOT a CarBodyMesh profile row: a bike shares almost nothing with the
        // car shell — narrow inline frame, two big wheels, exposed rider foam
        // block standing in for the seat/tank, one headlight. It fills the
        // same CarVisual contract so every existing consumer (sync pass,
        // audio, wreck tint, police) works unmodified:
        //   Body         — the frame mesh, tinted with the car paint
        //   Wheels[+-2]  — front and rear, spun by SpinWheels
        //   BrakeA/B     — both bound to the ONE tail lamp (index twice)
        //   Lights       — pool sprite + beam; Beams[2] with both indexes on
        //                  the single spot (the shadow-flag pass indexes [0]
        //                  and [1] unconditionally)
        //   SirenA/B/Glow stay null — bikes are never cop vehicles.
        static void BuildBike(CarVisual v, Transform t, Color tint, int seed)
        {
            // frame runs z -20 (tail) .. +22 (fork); wheels r=4.4
            const float wheelZF = 15f, wheelZR = -15f, wheelR = 4.4f;

            var sh = FlatSprite(t, "shadow", SpriteKit.Circle, new Color(0, 0, 0, 0.35f), 0.4f);
            sh.transform.localScale = new Vector3(34f / 32f, 12f / 32f, 1f);   // long-narrow blob
            sh.transform.localRotation = Quaternion.Euler(90f, 90f, 0f);      // long axis along z

            var frame = new MB();
            Color dark = tint * 0.5f, chrome = new Color(0.72f, 0.74f, 0.78f);

            // main spine: a slim box from tail tank to fork head
            frame.Quad(new Vector3(-1.6f, 7.2f, wheelZR + 4f), new Vector3(1.6f, 7.2f, wheelZF - 5f),
                       new Vector3(1.6f, 11.5f, wheelZF - 5f), new Vector3(-1.6f, 11.5f, wheelZR + 4f), tint);
            // seat + tank hump (paint), centered above the spine
            frame.Quad(new Vector3(-2.2f, 11.5f, -12f), new Vector3(2.2f, 11.5f, -12f),
                       new Vector3(2.2f, 15.5f, -3f), new Vector3(-2.2f, 15.5f, -3f), tint);
            frame.Quad(new Vector3(-2.2f, 15.5f, -3f), new Vector3(2.2f, 15.5f, -3f),
                       new Vector3(2.2f, 13.5f, 2f), new Vector3(-2.2f, 13.5f, 2f), tint);
            // front fork: two chrome struts up from the front axle to the bars
            frame.Quad(new Vector3(-0.9f, wheelR, wheelZF - 1.4f), new Vector3(-0.9f, 16.5f, wheelZF + 4.4f),
                       new Vector3(0.9f, 16.5f, wheelZF + 4.4f), new Vector3(0.9f, wheelR, wheelZF - 1.4f), chrome);
            // handlebar
            frame.Quad(new Vector3(-7f, 17f, wheelZF + 4.6f), new Vector3(7f, 17f, wheelZF + 4.6f),
                       new Vector3(7f, 18.2f, wheelZF + 3.8f), new Vector3(-7f, 18.2f, wheelZF + 3.8f), Cfg.Hex("#1c2029"));
            // rear fender over the tail wheel
            frame.Quad(new Vector3(-2f, 12.5f, wheelZR - 3.2f), new Vector3(2f, 12.5f, wheelZR - 3.2f),
                       new Vector3(2f, 14.2f, wheelZR + 2f), new Vector3(-2f, 14.2f, wheelZR + 2f), dark);
            // underbox so it isn't paper-thin edge-on
            frame.Quad(new Vector3(-1.6f, 5f, wheelZR + 4f), new Vector3(1.6f, 5f, wheelZR + 4f),
                       new Vector3(1.6f, 7.2f, wheelZF - 5f), new Vector3(-1.6f, 7.2f, wheelZF - 5f), dark);
            v.Body = MeshGo(t, "bike-frame", frame.Build(), Vector3.zero);
            v.Body.sharedMaterial = CarPaint;

            var wheel = WheelMesh(wheelR, 3.4f, 12, WheelC, HubC);
            v.Wheels = new Transform[2];
            v.Wheels[0] = MeshGo(t, "wheel-f", wheel, new Vector3(0f, wheelR, wheelZF)).transform;
            v.Wheels[1] = MeshGo(t, "wheel-r", wheel, new Vector3(0f, wheelR, wheelZR)).transform;

            Box(t, "head", 4.4f, 4.4f, 1.6f, new Vector3(0f, 14f, wheelZF + 4.2f), HeadlightC);
            v.BrakeA = Box(t, "tail", 3.4f, 2f, 0.8f, new Vector3(0f, 13f, wheelZR - 3.6f), Color.white);
            Tint(v.BrakeA, TailDim);
            v.BrakeB = v.BrakeA;   // one lamp, both sync slots

            // headlights: shared pool + one real spot, both Beams slots bound
            // to it (GameLoop's shadow-flag pass touches Beams[0] and [1]).
            v.Lights = new GameObject("lights");
            v.Lights.transform.SetParent(t, false);
            var conePivot = new GameObject("cone-pivot");
            conePivot.transform.SetParent(v.Lights.transform, false);
            conePivot.transform.localPosition = new Vector3(0f, 0.5f, 0f);
            conePivot.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var cone = new GameObject("cone");
            cone.transform.SetParent(conePivot.transform, false);
            cone.transform.localPosition = new Vector3(0f, 70f, 0f);
            cone.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            var csr = cone.AddComponent<SpriteRenderer>();
            csr.sprite = SpriteKit.Cone;
            csr.color = Color.white;

            var beamGo = new GameObject("beam");
            beamGo.transform.SetParent(v.Lights.transform, false);
            beamGo.transform.localPosition = new Vector3(0f, 14f, wheelZF + 4.2f);
            beamGo.transform.localRotation = Quaternion.Euler(12f, 0f, 0f);
            var bl = beamGo.AddComponent<Light>();
            bl.type = LightType.Spot;
            bl.color = HeadlightC;
            bl.range = 220f;
            bl.spotAngle = 52f;
            bl.innerSpotAngle = 24f;
            bl.intensity = 6f;
            bl.shadows = LightShadows.None;
            v.Beams = new Light[2];
            v.Beams[0] = bl;
            v.Beams[1] = bl;

            // silhouette jitter — same micro-variation the car branch gets,
            // scaled to a bike (length only, never width)
            float len = 0.94f + (Mathf.Abs(seed / 3) % 4) * 0.035f;
            t.localScale = new Vector3(1f, 1f, len);
        }

        /* ---------------------------------------------------- pedestrians */

        static readonly Color[] Pants =
        {
            Cfg.Hex("#2b3242"), Cfg.Hex("#3a4048"), Cfg.Hex("#232833"), Cfg.Hex("#4a3b2c"), Cfg.Hex("#39434e")
        };
        static readonly Color[] Hair =
        {
            Cfg.Hex("#17171c"), Cfg.Hex("#2e2013"), Cfg.Hex("#4b3a24"), Cfg.Hex("#5c6066"), Cfg.Hex("#101010")
        };
        static readonly Color[] Jackets =
        {
            Cfg.Hex("#2a2f3a"), Cfg.Hex("#3d2f28"), Cfg.Hex("#1f2937"), Cfg.Hex("#33393f")
        };
        static readonly Color ShoeC = Cfg.Hex("#14161c");

        static Mesh HeadMesh(float r, Color skin, Color hair)
        {
            var mb = new MB();
            const int Lat = 4, Lon = 8;
            for (int la = 0; la < Lat; la++)
            {
                float p0 = Mathf.PI * la / Lat, p1 = Mathf.PI * (la + 1) / Lat;
                for (int lo = 0; lo < Lon; lo++)
                {
                    float q0 = Mathf.PI * 2f * lo / Lon, q1 = Mathf.PI * 2f * (lo + 1) / Lon;
                    Vector3 a = Sph(r, p0, q0), b = Sph(r, p0, q1), c = Sph(r, p1, q1), d = Sph(r, p1, q0);
                    float midY = (a.y + c.y) / 2f, midZ = (a.z + c.z) / 2f;
                    Color col = (midY > r * 0.28f || (midZ < -r * 0.42f && midY > -r * 0.1f)) ? hair : skin;
                    if (la == 0) mb.Tri(new Vector3(0, r, 0), c, d, col);
                    else if (la == Lat - 1) mb.Tri(new Vector3(0, -r, 0), a, b, col);
                    else mb.Quad(a, b, c, d, col);
                }
            }
            return mb.Build();
        }

        static Vector3 Sph(float r, float phi, float theta)
        {
            return new Vector3(r * Mathf.Sin(phi) * Mathf.Cos(theta),
                               r * Mathf.Cos(phi),
                               r * Mathf.Sin(phi) * Mathf.Sin(theta));
        }

        static Transform Pivot(Transform parent, string name, Vector3 pos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            return go.transform;
        }

        public static PedVisual BuildPed(Color shirt, Color skin, int unusedOrder)
        {
            Init();
            var v = new PedVisual();
            v.Root = new GameObject("ped");
            var t = v.Root.transform;

            int hash = Mathf.Abs((int)(shirt.r * 255f) * 31 + (int)(shirt.g * 255f) * 17 + (int)(shirt.b * 255f) * 7);
            Color pants = Pants[hash % Pants.Length];
            Color hair = Hair[hash % Hair.Length];
            bool jacket = hash % 3 == 0;
            bool cap = hash % 4 == 0;
            bool skirt = hash % 5 == 0;
            Color torsoC = jacket ? Jackets[hash % Jackets.Length] : shirt;
            Color legC = skirt ? skin : pants;

            // T13: per-ped height from the same hash — 0.9..1.12 of the base
            // proportions. Reuses the "silhouette jitter" idea from BuildCar;
            // Y-only because widths must keep matching collision/limb pivots.
            float hScale = 0.9f + (hash % 7) * 0.035f;
            v.HeightScale = hScale;

            var sh = FlatSprite(t, "shadow", SpriteKit.Circle, new Color(0, 0, 0, 0.3f), 0.4f);
            sh.transform.localScale = new Vector3(15f / 32f, 11f / 32f, 1f);

            // human proportions: legs ~10.6, torso ~7, head ~5 on ~28 total.
            // Torso/hips are octagonal (not square) prisms, and arms/legs
            // are each two rigid segments meeting at a fixed elbow/knee
            // bend with a small joint ball hiding the seam — a standing
            // person reads with shoulders, a waist and slightly bent limbs
            // instead of stacked bricks.
            var torso = new MB();
            AddTaperPrism(torso, 8, 7.0f, 4.2f, 9.2f, 5.0f, 7.2f, Vector3.zero, torsoC);
            v.Body = MeshGo(t, "torso", torso.Build(), new Vector3(0f, 13.4f, 0f));

            if (skirt)
            {
                var sk = new MB();
                AddTaperPrism(sk, 8, 9.2f, 5.4f, 7.0f, 4.2f, 4.8f, Vector3.zero, pants);
                MeshGo(t, "skirt", sk.Build(), new Vector3(0f, 8.6f, 0f));
            }
            else
            {
                var hips = new MB();
                AddTaperPrism(hips, 8, 6.8f, 4.1f, 7.0f, 4.2f, 3.0f, Vector3.zero, pants);
                MeshGo(t, "hips", hips.Build(), new Vector3(0f, 10.4f, 0f));
            }

            var neck = new MB();
            AddTaperPrism(neck, 8, 2.4f, 2.4f, 2.4f, 2.4f, 1.2f, Vector3.zero, skin);
            MeshGo(t, "neck", neck.Build(), new Vector3(0f, 20.6f, 0f));
            v.Head = MeshGo(t, "head", HeadMesh(2.6f, skin, hair), new Vector3(0f, 24.2f, 0f));
            if (cap)
                Box(t, "cap", 4.6f, 1.1f, 5f, new Vector3(0f, 26.1f, 0.4f), pants);

            // legs: thigh (rigid, swung by the walk-cycle pivot) + shin,
            // bent forward a few degrees at a fixed knee so the leg isn't
            // a dead-straight pole even when standing still
            const float thighLen = 5.4f, shinLen = 5.6f;
            v.LegA = Pivot(t, "leg-a", new Vector3(-2.0f, 10.4f, 0f));
            v.LegB = Pivot(t, "leg-b", new Vector3(2.0f, 10.4f, 0f));
            foreach (var leg in new[] { v.LegA, v.LegB })
            {
                var thigh = new MB();
                AddTaperPrism(thigh, 8, 3.1f, 3.6f, 2.6f, 3.0f, thighLen, Vector3.zero, legC);
                MeshGo(leg, "thigh", thigh.Build(), new Vector3(0f, -thighLen, 0f));

                var knee = Pivot(leg, "knee", new Vector3(0f, -thighLen, 0f));
                knee.localRotation = Quaternion.Euler(14f, 0f, 0f);
                MeshGo(knee, "knee-ball", JointBall(1.5f, legC), Vector3.zero);

                var shin = new MB();
                AddTaperPrism(shin, 8, 2.6f, 3.0f, 2.1f, 2.4f, shinLen, Vector3.zero, legC);
                MeshGo(knee, "shin", shin.Build(), new Vector3(0f, -shinLen, 0f));
                Box(knee, "shoe", 2.8f, 1.4f, 4.6f, new Vector3(0f, -shinLen + 0.1f, 0.9f), ShoeC);
            }

            // arms: upper arm + forearm bent at a fixed elbow, small
            // shoulder/elbow balls covering the seams
            const float upperLen = 3.6f, foreLen = 3.8f;
            Color sleeveC = torsoC * 0.94f;
            v.ArmA = Pivot(t, "arm-a", new Vector3(-5.4f, 19.8f, 0f));
            v.ArmB = Pivot(t, "arm-b", new Vector3(5.4f, 19.8f, 0f));
            for (int side = 0; side < 2; side++)
            {
                var arm = side == 0 ? v.ArmA : v.ArmB;
                float mirror = side == 0 ? -1f : 1f;
                MeshGo(arm, "shoulder-ball", JointBall(1.9f, sleeveC), Vector3.zero);

                var upper = new MB();
                AddTaperPrism(upper, 8, 2.5f, 2.7f, 2.2f, 2.4f, upperLen, Vector3.zero, sleeveC);
                MeshGo(arm, "upper-arm", upper.Build(), new Vector3(0f, -upperLen, 0f));

                var elbow = Pivot(arm, "elbow", new Vector3(0f, -upperLen, 0f));
                elbow.localRotation = Quaternion.Euler(mirror * 4f, 0f, 16f);
                MeshGo(elbow, "elbow-ball", JointBall(1.3f, sleeveC), Vector3.zero);

                var fore = new MB();
                AddTaperPrism(fore, 8, 2.2f, 2.4f, 1.9f, 2.0f, foreLen, Vector3.zero, sleeveC);
                MeshGo(elbow, "forearm", fore.Build(), new Vector3(0f, -foreLen, 0f));
                Box(elbow, "hand", 2.0f, 2.2f, 2.0f, new Vector3(0f, -foreLen - 1.0f, 0f), skin);
            }
            return v;
        }

        /* --------------------------------------------------- world props */

        public static GameObject BuildPackage()
        {
            Init();
            var root = new GameObject("package");
            var glow = FlatSprite(root.transform, "glow", SpriteKit.Glow,
                new Color(1f, 178f / 255f, 36f / 255f, 0.5f), 0.6f);
            glow.transform.localScale = new Vector3(48f / 128f, 48f / 128f, 1f);
            var boxGo = new GameObject("box");
            boxGo.transform.SetParent(root.transform, false);
            boxGo.transform.localPosition = new Vector3(0f, 6f, 0f);
            var mf = boxGo.AddComponent<MeshFilter>();
            var mesh = BoxMesh(11f, 11f, 11f, Cfg.Hex("#ffb224"));
            OffsetMesh(mesh, new Vector3(0f, -5.5f, 0f));
            mf.sharedMesh = mesh;
            var mr = boxGo.AddComponent<MeshRenderer>();
            mr.sharedMaterial = White;
            return root;
        }

        // weapon crate pickups: a squat gray box whose accent color and
        // marking name the tier — red cross for the pistol/ammo crate, a
        // teal barrel stripe for the SMG, an orange double stripe for the
        // shotgun — plus a matching low-key glow so each reads distinctly
        // from the amber package pickups at a glance.
        public static GameObject BuildWeaponPickup(int kind = Cfg.CratePistol)
        {
            Init();
            Color accent = kind == Cfg.CrateSmg ? Cfg.Hex("#4fb0a5")
                         : kind == Cfg.CrateShotgun ? Cfg.Hex("#e0913f")
                         : Cfg.Hex("#e05252");

            var root = new GameObject("weapon-pickup");
            var glow = FlatSprite(root.transform, "glow", SpriteKit.Glow,
                new Color(accent.r, accent.g, accent.b, 0.45f), 0.6f);
            glow.transform.localScale = new Vector3(44f / 128f, 44f / 128f, 1f);

            var crateGo = new GameObject("crate");
            crateGo.transform.SetParent(root.transform, false);
            crateGo.transform.localPosition = new Vector3(0f, 5.5f, 0f);
            var mf = crateGo.AddComponent<MeshFilter>();
            var mesh = BoxMesh(12f, 8f, 9f, Cfg.Hex("#3a3f47"));
            OffsetMesh(mesh, new Vector3(0f, -4f, 0f));
            mf.sharedMesh = mesh;
            var mr = crateGo.AddComponent<MeshRenderer>();
            mr.sharedMaterial = White;

            if (kind == Cfg.CrateSmg)
            {
                // a barrel laid across the lid
                Box(root.transform, "barrel", 9f, 0.9f, 0.9f, new Vector3(0f, 5.9f, 4.2f), accent);
            }
            else if (kind == Cfg.CrateShotgun)
            {
                // twin barrels
                Box(root.transform, "barrel-a", 9.5f, 0.8f, 0.8f, new Vector3(0f, 6.1f, 4.2f), accent);
                Box(root.transform, "barrel-b", 9.5f, 0.8f, 0.8f, new Vector3(0f, 5.4f, 4.2f), accent);
            }
            else
            {
                Box(root.transform, "cross-h", 7f, 0.6f, 1.6f, new Vector3(0f, 5.6f, 4.6f), accent);
                Box(root.transform, "cross-v", 1.6f, 0.6f, 7f, new Vector3(0f, 5.6f, 4.6f), accent);
            }
            return root;
        }

        public static GameObject BuildMarker(Color tint)
        {
            Init();
            var root = new GameObject("marker");
            for (int i = 0; i < 2; i++)
            {
                var beam = new GameObject("beam" + i);
                beam.transform.SetParent(root.transform, false);
                beam.transform.localPosition = new Vector3(0f, 45f, 0f);
                beam.transform.localRotation = Quaternion.Euler(0f, i * 90f, 0f);
                beam.transform.localScale = new Vector3(30f, 90f, 1f);
                var sr = beam.AddComponent<SpriteRenderer>();
                sr.sprite = SpriteKit.White;
                sr.color = new Color(tint.r, tint.g, tint.b, 0.30f);
            }
            var glow = FlatSprite(root.transform, "glow", SpriteKit.Glow,
                new Color(tint.r, tint.g, tint.b, 0.5f), 0.6f);
            glow.transform.localScale = new Vector3(90f / 128f, 90f / 128f, 1f);
            return root;
        }

        // T15: street signboard standing beside an active mission marker —
        // the "thank you for your cooperation" board that gives the glowing
        // beam a physical anchor on the pavement. A post, a framed panel
        // with mission-blue trim, and a small lamp cap that echoes the
        // marker color. Built once, repositioned every frame alongside the
        // marker by SyncMission.
        public static GameObject BuildMissionBoard(Color tint)
        {
            Init();
            var root = new GameObject("mission-board");

            // post: slim dark pole, ground to panel height
            Box(root.transform, "post", 1.6f, 30f, 1.6f, new Vector3(0f, 15f, 0f), Cfg.Hex("#232a34"));
            // panel: wider than tall, centered at the top of the post
            Box(root.transform, "panel", 14f, 10f, 1.2f, new Vector3(0f, 31f, 0f), Cfg.Hex("#1b222c"));
            // face: mission-blue inset so the panel reads as "official"
            Box(root.transform, "face", 11f, 7f, 0.3f, new Vector3(0f, 31f, 0.7f),
                new Color(tint.r * 0.85f, tint.g * 0.85f, tint.b * 0.85f));
            // cap: a little lamp box echoing the tint above the panel
            Box(root.transform, "cap", 3f, 1.6f, 2.4f, new Vector3(0f, 37f, 0f), Cfg.Hex("#10141c"));
            var glow = FlatSprite(root.transform, "cap-glow", SpriteKit.Glow,
                new Color(tint.r, tint.g, tint.b, 0.4f), 38.2f);
            glow.transform.localScale = new Vector3(24f / 128f, 24f / 128f, 1f);
            return root;
        }

        /* ------------------------------------------------------------ trees */

        // Foliage used to be two crossed billboard sprites plus a flat
        // circle cap — unlit, so it rendered as a solid green sticker with
        // no form at any time of day. It is real geometry now: a trunk and
        // four overlapping low-poly blobs, which take the sun, self-shade
        // and cast a shadow like everything else.
        //
        // Every mesh is built once per variant and shared, so a city full
        // of trees costs 5 variants' worth of meshes rather than one set
        // per tree (the old code allocated a fresh trunk mesh per tree).
        const int TreeVariants = 5;
        static Mesh[] treeTrunk;
        static Mesh[][] treeCanopy;
        static Vector3[][] treeCanopyPos;

        static void EnsureTreeMeshes()
        {
            if (treeTrunk != null) return;
            // blob layout is fixed per variant; the root transform scales it
            float[] ox = { 0f, -7.5f, 7f, 1.5f };
            float[] oy = { 0f, -3.5f, -4.5f, 6.5f };
            float[] oz = { 0f, 5f, -5.5f, 2f };
            float[] rr = { 15f, 10f, 9.5f, 8.5f };

            treeTrunk = new Mesh[TreeVariants];
            treeCanopy = new Mesh[TreeVariants][];
            treeCanopyPos = new Vector3[TreeVariants][];
            for (int v = 0; v < TreeVariants; v++)
            {
                float t = v / (float)(TreeVariants - 1);
                // real foliage albedo (~0.30), muted rather than the old
                // poster-paint #2a5f31 — the sun supplies the brightness
                Color leaf = Color.Lerp(Cfg.Hex("#4a6b38"), Cfg.Hex("#587a42"), t);
                treeTrunk[v] = BoxMesh(4.5f, 19f, 4.5f,
                                       Color.Lerp(Cfg.Hex("#5a4530"), Cfg.Hex("#6b5540"), t));
                treeCanopy[v] = new Mesh[4];
                treeCanopyPos[v] = new Vector3[4];
                for (int i = 0; i < 4; i++)
                {
                    Color c = leaf * (i % 2 == 0 ? 1f : 0.86f);
                    c.a = 1f;
                    treeCanopy[v][i] = JointBall(rr[i], c);
                    treeCanopyPos[v][i] = new Vector3(ox[i], 23f + oy[i], oz[i]);
                }
            }
        }

        public static GameObject BuildTree(Vector3 world, float seed)
        {
            Init();
            EnsureTreeMeshes();
            float f = Mathf.Abs(seed % 1f);
            int v = Mathf.Clamp((int)(f * TreeVariants), 0, TreeVariants - 1);

            var root = new GameObject("tree");
            root.transform.position = world;
            // vary size and facing so a street of trees isn't a row of clones
            root.transform.localScale = Vector3.one * (0.85f + f * 0.5f);
            root.transform.localRotation = Quaternion.Euler(0f, f * 360f, 0f);

            MeshGo(root.transform, "trunk", treeTrunk[v], Vector3.zero);
            for (int i = 0; i < 4; i++)
                MeshGo(root.transform, "canopy" + i, treeCanopy[v][i], treeCanopyPos[v][i]);
            return root;
        }

        public static GameObject BuildLamp(Vector3 poleWorld, Vector3 glowWorld)
        {
            Init();
            var root = new GameObject("lamp");
            root.transform.position = poleWorld;
            Box(root.transform, "pole", 2.2f, 34f, 2.2f, Vector3.zero, Cfg.Hex("#525a68"));
            // the head is a light source, so it keeps its brightness instead
            // of being dimmed to nothing by the night tint
            Box(root.transform, "head", 5.5f, 2.6f, 5.5f, new Vector3(0f, 34f, 0f),
                Cfg.Hex("#ffd68c"), 0f, Emissive);
            // pool of light on the road underneath — the city is night-locked
            // now, so this does real work rather than being a faint hint
            var glow = FlatSprite(null, "lamp-glow", SpriteKit.Glow, new Color(1f, 214f / 255f, 140f / 255f, 0.22f), 0f);
            glow.transform.SetParent(root.transform, true);
            glow.transform.position = new Vector3(glowWorld.x, 0.5f, glowWorld.z);
            glow.transform.localScale = new Vector3(210f / 128f, 210f / 128f, 1f);

            // A REAL light. This is the whole reason for the URP move: the
            // old built-in forward path capped out at a handful of per-pixel
            // lights per object, so a street of lamps had to be faked with
            // the glow sprite above. Forward+ clusters them instead.
            // Shadows stay off — there are hundreds of these and shadowed
            // point lights would be ruinous. Created disabled; CityRenderer
            // switches on only the ones near the player.
            var lightGo = new GameObject("lamp-light");
            lightGo.transform.SetParent(root.transform, false);
            lightGo.transform.localPosition = new Vector3(0f, 31f, 0f);
            var lt = lightGo.AddComponent<Light>();
            lt.type = LightType.Point;
            lt.color = Cfg.Hex("#ffce88");
            lt.range = 130f;
            lt.intensity = 4.5f;
            lt.shadows = LightShadows.None;
            lt.enabled = false;
            return root;
        }

        /* ------------------------------------------------ street furniture */

        // Traffic signal. Which lens is lit is fixed per junction from the
        // seed rather than running a real cycle — a live signal phase would
        // mean a per-frame update on hundreds of props for something you
        // glance at once. Lens colors are deliberately bright enough to clear
        // the Emissive material's luminance threshold; a true traffic red
        // (#ff3b30) sits just under it and would render dark.
        // Realism pass (Phase 5): returns a TrafficSignal whose three lenses
        // are live — CityRenderer tints them each frame to the stateless
        // light phase, instead of the old one-shot "a random lens is lit"
        // that never changed. All three lenses share the emissive material;
        // the shader's luminance-threshold emission makes the tinted-to-white
        // lens glow while the dimmed ones stay dark, so toggling is just a
        // Tint() call. The base lens colours are baked into the mesh.
        public static TrafficSignal BuildTrafficLight(Vector3 world, float seed)
        {
            Init();
            var sig = new TrafficSignal();
            var root = new GameObject("traffic-light");
            root.transform.position = world;
            float f = Mathf.Repeat(seed, 1f);
            root.transform.localRotation = Quaternion.Euler(0f, Mathf.Floor(f * 4f) * 90f, 0f);

            Box(root.transform, "pole", 2.4f, 46f, 2.4f, Vector3.zero, Cfg.Hex("#3f4650"));
            Box(root.transform, "arm", 2f, 2f, 15f, new Vector3(0f, 45f, 7f), Cfg.Hex("#3f4650"));
            Box(root.transform, "housing", 7f, 15.5f, 5f, new Vector3(0f, 37f, 13.5f), Cfg.Hex("#20252d"));

            Color[] lens = { Cfg.Hex("#ff6055"), Cfg.Hex("#ffc04a"), Cfg.Hex("#5ce68c") };
            sig.LensR = Box(root.transform, "lens0", 3.8f, 3.8f, 1.2f,
                new Vector3(0f, 42.5f, 16.3f), lens[0], 0f, Emissive);
            sig.LensA = Box(root.transform, "lens1", 3.8f, 3.8f, 1.2f,
                new Vector3(0f, 37.7f, 16.3f), lens[1], 0f, Emissive);
            sig.LensG = Box(root.transform, "lens2", 3.8f, 3.8f, 1.2f,
                new Vector3(0f, 32.9f, 16.3f), lens[2], 0f, Emissive);

            sig.Root = root;
            // Lens faces world +z at yaw 0; world +z = JS north (dir 3), and
            // each +90° yaw steps clockwise in JS space. A signal's Facing is
            // the JS dir of the traffic it governs.
            sig.Facing = new[] { 3, 0, 1, 2 }[((int)(f * 4f)) % 4];
            return sig;
        }

        public static GameObject BuildHydrant(Vector3 world)
        {
            Init();
            var root = new GameObject("hydrant");
            root.transform.position = world;
            var body = new MB();
            AddTaperPrism(body, 8, 7f, 7f, 5.5f, 5.5f, 12f, Vector3.zero, Cfg.Hex("#b8352f"));
            MeshGo(root.transform, "body", body.Build(), Vector3.zero);
            Box(root.transform, "cap", 4.6f, 2.6f, 4.6f, new Vector3(0f, 12f, 0f), Cfg.Hex("#8f2a25"));
            Box(root.transform, "spout-l", 4.2f, 2.6f, 2.6f, new Vector3(-3.6f, 7.5f, 0f), Cfg.Hex("#8f2a25"));
            Box(root.transform, "spout-r", 4.2f, 2.6f, 2.6f, new Vector3(3.6f, 7.5f, 0f), Cfg.Hex("#8f2a25"));
            return root;
        }

        public static GameObject BuildBin(Vector3 world, float seed)
        {
            Init();
            var root = new GameObject("bin");
            root.transform.position = world;
            root.transform.localRotation = Quaternion.Euler(0f, Mathf.Repeat(seed, 1f) * 360f, 0f);
            var body = new MB();
            AddTaperPrism(body, 8, 11f, 11f, 12.5f, 12.5f, 17f, Vector3.zero, Cfg.Hex("#39424c"));
            MeshGo(root.transform, "body", body.Build(), Vector3.zero);
            Box(root.transform, "rim", 14f, 1.6f, 14f, new Vector3(0f, 17f, 0f), Cfg.Hex("#2a323b"));
            return root;
        }

        // Newspaper box / utility cabinet — small silhouette breaker so long
        // stretches of empty pavement have something on them.
        public static GameObject BuildStreetBox(Vector3 world, float seed)
        {
            Init();
            var root = new GameObject("street-box");
            root.transform.position = world;
            float f = Mathf.Repeat(seed, 1f);
            root.transform.localRotation = Quaternion.Euler(0f, Mathf.Floor(f * 4f) * 90f, 0f);
            Color body = f > 0.5f ? Cfg.Hex("#2f5f7a") : Cfg.Hex("#5a4a3a");
            Box(root.transform, "body", 9f, 22f, 7f, Vector3.zero, body);
            Box(root.transform, "lid", 10f, 1.8f, 8f, new Vector3(0f, 22f, 0f), body * 0.7f);
            return root;
        }

        // Realism pass (Phase 7): a spike strip laid across a lane as part
        // of a roadblock. A low yellow-and-black bar with a row of little
        // spike prisms — reads at speed as "don't drive over this" without
        // needing a real texture. `world` includes the JS heading (see
        // MeshKit.YawJs) so the strip lies across the lane it was dropped in.
        public static GameObject BuildSpikeStrip(Vector3 world, float headingJs)
        {
            Init();
            var root = new GameObject("spike-strip");
            root.transform.position = world;
            root.transform.rotation = YawJs(headingJs) * Quaternion.Euler(0f, 90f, 0f);
            Box(root.transform, "bar", 34f, 1.4f, 6f, new Vector3(0f, 0.7f, 0f), Cfg.Hex("#f2c230"));
            for (int i = -3; i <= 3; i++)
            {
                var spike = new MB();
                AddTaperPrism(spike, 4, 1.6f, 1.6f, 0.1f, 0.1f, 3f, Vector3.zero, Cfg.Hex("#20232a"));
                MeshGo(root.transform, "spike" + i, spike.Build(), new Vector3(i * 4.5f, 1.4f, 0f));
            }
            return root;
        }

        public static void OffsetMesh(Mesh m, Vector3 off)
        {
            var verts = m.vertices;
            for (int i = 0; i < verts.Length; i++) verts[i] += off;
            m.vertices = verts;
            m.RecalculateBounds();
        }
    }
}
