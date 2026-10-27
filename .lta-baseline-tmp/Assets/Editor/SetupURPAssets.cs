/* Phase 2 of the URP migration: build the pipeline assets and wire them in.

   Separate from SetupURP.cs because this file references URP types, which
   only exist once the package from phase 1 is installed.

   Creates Assets/Settings/LTA-URP.asset (+ its renderer) configured for a
   night city: Forward+ so hundreds of street lamps and headlights can be
   real lights rather than fakes, HDR on so bloom and tonemapping have
   headroom above 1.0, and a shadow distance big enough for this map's
   480-unit blocks and 1400-unit towers.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod SetupURPAssets.Build
*/
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class SetupURPAssets
{
    const string Dir = "Assets/Settings";
    const string RendererPath = Dir + "/LTA-Renderer.asset";
    const string PipelinePath = Dir + "/LTA-URP.asset";

    public static void Build()
    {
        if (!Directory.Exists(Dir)) Directory.CreateDirectory(Dir);

        // ---- renderer -------------------------------------------------
        var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
        AssetDatabase.CreateAsset(rendererData, RendererPath);

        // Forward+ is the whole point of the migration: classic forward caps
        // out at a handful of per-pixel lights per object, which cannot light
        // a street of lamps.
        var soR = new SerializedObject(rendererData);
        SetEnum(soR, "m_RenderingMode", 2, "renderingMode(Forward+)");
        soR.ApplyModifiedPropertiesWithoutUndo();

        AddSSAO(rendererData);
        EditorUtility.SetDirty(rendererData);

        // ---- pipeline asset -------------------------------------------
        var pipeline = UniversalRenderPipelineAsset.Create(rendererData);
        AssetDatabase.CreateAsset(pipeline, PipelinePath);

        var so = new SerializedObject(pipeline);
        SetBool(so, "m_SupportsHDR", true);
        SetInt(so, "m_MSAA", 4);
        SetBool(so, "m_MainLightShadowsSupported", true);
        SetInt(so, "m_MainLightShadowmapResolution", 2048);
        SetFloat(so, "m_ShadowDistance", 1100f);
        SetInt(so, "m_ShadowCascadeCount", 4);
        SetBool(so, "m_SoftShadowsSupported", true);
        // additional (point/spot) lights: per-pixel, generous budget
        SetEnum(so, "m_AdditionalLightsRenderingMode", 1, "additionalLights(PerPixel)");
        SetInt(so, "m_AdditionalLightsPerObjectLimit", 8);
        SetBool(so, "m_AdditionalLightShadowsSupported", true);
        SetInt(so, "m_AdditionalLightsShadowmapResolution", 1024);
        so.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(pipeline);

        AssetDatabase.SaveAssets();

        // ---- wire into graphics + every quality level -------------------
        GraphicsSettings.defaultRenderPipeline = pipeline;
        int levels = QualitySettings.names.Length;
        int restore = QualitySettings.GetQualityLevel();
        for (int i = 0; i < levels; i++)
        {
            QualitySettings.SetQualityLevel(i, false);
            QualitySettings.renderPipeline = pipeline;
        }
        QualitySettings.SetQualityLevel(restore, false);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        Debug.Log("[SetupURPAssets] pipeline=" + PipelinePath +
                  " renderer=" + RendererPath +
                  " default=" + (GraphicsSettings.defaultRenderPipeline != null
                                 ? GraphicsSettings.defaultRenderPipeline.name : "NULL"));
    }

    static void AddSSAO(ScriptableRendererData data)
    {
        // SSAO is a renderer feature, not a Volume override — it has to be
        // attached to the renderer asset itself.
        var t = System.Type.GetType(
            "UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion, Unity.RenderPipelines.Universal.Runtime");
        if (t == null)
        {
            Debug.LogWarning("[SetupURPAssets] SSAO feature type not found — skipping");
            return;
        }
        var feature = (ScriptableRendererFeature)ScriptableObject.CreateInstance(t);
        feature.name = "SSAO";
        data.rendererFeatures.Add(feature);
        AssetDatabase.AddObjectToAsset(feature, data);
        Debug.Log("[SetupURPAssets] added SSAO renderer feature");
    }

    /* ---- SerializedObject helpers: URP setters are mostly non-public --- */

    static void SetBool(SerializedObject so, string prop, bool v)
    {
        var p = so.FindProperty(prop);
        if (p == null) { Debug.LogWarning("[SetupURPAssets] missing " + prop); return; }
        p.boolValue = v;
    }

    static void SetInt(SerializedObject so, string prop, int v)
    {
        var p = so.FindProperty(prop);
        if (p == null) { Debug.LogWarning("[SetupURPAssets] missing " + prop); return; }
        p.intValue = v;
    }

    static void SetFloat(SerializedObject so, string prop, float v)
    {
        var p = so.FindProperty(prop);
        if (p == null) { Debug.LogWarning("[SetupURPAssets] missing " + prop); return; }
        p.floatValue = v;
    }

    static void SetEnum(SerializedObject so, string prop, int v, string label)
    {
        var p = so.FindProperty(prop);
        if (p == null) { Debug.LogWarning("[SetupURPAssets] missing " + prop + " (" + label + ")"); return; }
        p.intValue = v;
    }
}
