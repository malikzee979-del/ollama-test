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
        // sun's own forward direction, so the two never drift apart.
        public static void Apply(Color skyTop, Color skyHorizon, Vector3 sunDirWS, Color sunColor)
        {
            var m = Material;
            m.SetColor("_SkyTop", skyTop);
            m.SetColor("_SkyHorizon", skyHorizon);
            m.SetVector("_SunDir", sunDirWS);
            m.SetColor("_SunColor", sunColor);
        }
    }
}
