/* ==========================================================================
   Local Theft Auto — runtime sprite factory + entity visual builders.
   The JS original draws everything with canvas primitives; here every
   texture is baked once at startup from the same shapes and colors, so
   the project ships with zero image assets.
   ========================================================================== */
using UnityEngine;

namespace LocalTheftAuto
{
    public static class SpriteKit
    {
        static Texture2D whiteTex;
        static Sprite whiteSpr, circleSpr, glowSpr, coneSpr, skidSpr, vignetteSpr;

        public static void Init()
        {
            if (whiteTex != null) return;

            whiteTex = Bake(1, 1, (x, y) => Color.white);
            whiteSpr = ToSprite(whiteTex);

            circleSpr = ToSprite(Bake(32, 32, (x, y) =>
            {
                float dx = x - 15.5f, dy = y - 15.5f;
                float d = Mathf.Sqrt(dx * dx + dy * dy) / 15.5f;
                float a = Mathf.Clamp01((1f - d) * 15.5f); // 1px AA edge
                return new Color(1f, 1f, 1f, a);
            }));

            glowSpr = ToSprite(Bake(128, 128, (x, y) =>
            {
                float dx = (x - 63.5f) / 63.5f, dy = (y - 63.5f) / 63.5f;
                float d = Mathf.Clamp01(Mathf.Sqrt(dx * dx + dy * dy));
                float a = (1f - d) * (1f - d);
                return new Color(1f, 1f, 1f, a);
            }));

            // headlight cone from drawLights(): trapezoid x=14..140, half
            // width 8 -> 34, warm white fading to 0. Texture is in the
            // car's local frame (origin = car center).
            coneSpr = ToSprite(Bake(140, 68, (x, y) =>
            {
                if (x < 14) return Color.clear;
                float k = (x - 14f) / 126f;
                float half = Mathf.Lerp(8f, 34f, k);
                float dy = Mathf.Abs(y - 33.5f);
                if (dy > half + 1f) return Color.clear;
                float edge = Mathf.Clamp01(half + 1f - dy);
                float a = 0.16f * (1f - k) * Mathf.Clamp01(edge);
                return new Color(1f, 240f / 255f, 200f / 255f, a);
            }));

            // skid mark: two dark stripes from drawSkids()
            skidSpr = ToSprite(Bake(6, 19, (x, y) =>
            {
                int yjs = 9 - y; // y down -> texture rows
                if ((yjs >= 5 && yjs < 8) || (yjs >= -8 && yjs < -5))
                    return Color.black;
                return Color.clear;
            }));

            vignetteSpr = ToSprite(Bake(256, 256, (x, y) =>
            {
                float dx = (x - 127.5f) / 127.5f, dy = (y - 127.5f) / 127.5f;
                float d = Mathf.Sqrt(dx * dx + dy * dy);
                float a = Mathf.Clamp01((d - 0.42f) / (0.72f - 0.42f)) * 0.40f;
                return new Color(0f, 0f, 0f, a);
            }));
        }

        /* -------------------------------------------------- tex helpers */

        public delegate Color PixelFn(int x, int y);

        public static Texture2D Bake(int w, int h, PixelFn fn)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
            tex.wrapMode = TextureWrapMode.Clamp;
            tex.filterMode = FilterMode.Bilinear;
            var px = new Color32[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                    px[y * w + x] = fn(x, h - 1 - y); // row 0 = bottom; fn sees y-down
            tex.SetPixels32(px);
            tex.Apply(false, true);
            return tex;
        }

        public static Sprite ToSprite(Texture2D t)
        {
            return Sprite.Create(t, new Rect(0, 0, t.width, t.height),
                new Vector2(0.5f, 0.5f), 1f); // 1 texel = 1 world unit (= 1 game px)
        }

        /* ------------------------------------------------- go factories */

        public static GameObject Quad(string name, Sprite spr, Color tint, int order, Transform parent)
        {
            var go = new GameObject(name);
            if (parent != null) go.transform.SetParent(parent, false);
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = spr;
            sr.color = tint;
            sr.sortingOrder = order;
            return go;
        }

        public static GameObject BuildParticle(byte kind)
        {
            Sprite spr = kind == ParticleEnt.Spark ? whiteSpr : circleSpr;
            var go = Quad("particle", spr, Color.white, 0, null);
            if (kind == ParticleEnt.Spark) go.transform.localScale = new Vector3(3f, 3f, 1f);
            return go;
        }

        public static GameObject BuildSkid()
        {
            return Quad("skid", skidSpr, Color.black, 0, null);
        }

        public static Sprite White { get { Init(); return whiteSpr; } }
        public static Texture2D WhiteTex { get { Init(); return whiteTex; } }
        public static Sprite Circle { get { Init(); return circleSpr; } }
        public static Sprite Glow { get { Init(); return glowSpr; } }
        public static Sprite Cone { get { Init(); return coneSpr; } }
        public static Sprite Vignette { get { Init(); return vignetteSpr; } }

        // Unity 6 ships "LegacyRuntime.ttf"; older editors ship "Arial.ttf"
        public static Font GameFont()
        {
            string[] names = { "LegacyRuntime.ttf", "Arial.ttf" };
            for (int i = 0; i < names.Length; i++)
            {
                try
                {
                    Font f = Resources.GetBuiltinResource<Font>(names[i]);
                    if (f != null) return f;
                }
                catch (System.Exception) { /* try next */ }
            }
            return null;
        }
    }
}
