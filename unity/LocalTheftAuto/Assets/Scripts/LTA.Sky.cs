/* ==========================================================================
   Local Theft Auto — procedural gradient skybox.
   Replaces the flat CameraClearFlags.SolidColor background with a cheap
   vertical-gradient sky plus a soft sun/moon disc, so open sky above the
   towers reads as atmosphere instead of a flat paint swatch. One material,
   built in code like everything else in this renderer — no textures.
   GameLoop.UpdateWorldFX pushes the same sky/fog colors and sun direction it
   already computes into this material every frame, so the skybox always
   matches RenderSettings.fogColor at the horizon with no visible seam.
   ========================================================================== */
using UnityEngine;

namespace LocalTheftAuto
{
    public static class SkyKit
    {
        static Material mat;

        public static Material Material
        {
            get
            {
                if (mat == null)
                {
                    var shader = Resources.Load<Shader>("LTA-Sky");
                    mat = new Material(shader);
                    RenderSettings.skybox = mat;
                }
                return mat;
            }
        }

        // Called once per frame from UpdateWorldFX with the sky/horizon
        // colors it already computed for RenderSettings.fogColor and the
        // sun's own facing, plus the T17 extras:
        //   dayAmount — 0 deep night .. 1 full day; gates the starfield and
        //     picks the warm (low-sun) sunset/dawn band strength,
        //   sunElevation — abs of the sun's height above the horizon; the
        //     band is strongest exactly when the sun is at the horizon.
        public static void Apply(Color skyTop, Color skyHorizon, Vector3 sunDirWS, Color sunColor,
                                 float dayAmount, float sunElevation, Color bandColor)
        {
            var m = Material;
            m.SetColor("_SkyTop", skyTop);
            m.SetColor("_SkyHorizon", skyHorizon);
            m.SetVector("_SunDir", sunDirWS);
            m.SetColor("_SunColor", sunColor);
            m.SetFloat("_NightAmount", 1f - Mathf.Clamp01(dayAmount));
            // the warm band fades with sun height: full at the horizon,
            // gone once the sun is well up
            float bandAmt = Mathf.Clamp01(1f - sunElevation * 3f)
                            * (1f - Mathf.Clamp01(dayAmount * 0.5f));
            bandColor.a *= bandAmt;
            m.SetColor("_BandColor", bandColor);
        }
    }
}
