// Realism pass: a cheap procedural gradient skybox, replacing the flat
// CameraClearFlags.SolidColor the renderer used before. One full-screen-ish
// pass over the skybox cube's 12 triangles — no textures, no per-frame
// cubemap render, just a vertical gradient plus a soft sun/moon disc along
// the existing directional light's forward direction. Colors and the sun
// direction are pushed in once per frame from GameLoop.UpdateWorldFX, reusing
// the same sky/fog values already computed there so the horizon always
// matches RenderSettings.fogColor with no visible seam.
//
// Lives in Resources/ for the same reason as LTA-Lit: the material is built
// in code (LTA.Sky.cs), so nothing else keeps this shader referenced.
Shader "LTA/Sky"
{
    Properties
    {
        _SkyTop     ("Sky Top", Color) = (0.07, 0.11, 0.20, 1)
        _SkyHorizon ("Sky Horizon", Color) = (0.29, 0.33, 0.42, 1)
        _SunDir     ("Sun/Moon Direction", Vector) = (0, 1, 0, 0)
        _SunColor   ("Sun/Moon Color", Color) = (1, 0.95, 0.85, 1)
        _SunSize    ("Sun/Moon Disc Size", Range(0.0005, 0.02)) = 0.003
    }

    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" "RenderPipeline" = "UniversalPipeline" }
        Cull Off
        ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _SkyTop;
                half4 _SkyHorizon;
                half4 _SunDir;
                half4 _SunColor;
                half  _SunSize;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 dirOS : TEXCOORD0; };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.dirOS = IN.positionOS.xyz;   // skybox cube: object-space position IS the view direction
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                half3 dir = normalize(IN.dirOS);

                // Vertical gradient: horizon band widened above the true
                // horizon line so towers silhouette against a lit sky rather
                // than a hard color band.
                half t = saturate(dir.y * 1.3 + 0.15);
                half3 col = lerp(_SkyHorizon.rgb, _SkyTop.rgb, t);

                // Soft sun/moon disc plus a gentle glow halo around it —
                // cheap: one dot product, two smoothstep ramps.
                half sunDot = saturate(dot(dir, normalize(_SunDir.xyz)));
                half disc = smoothstep(1.0 - _SunSize, 1.0 - _SunSize * 0.4, sunDot);
                half glow = smoothstep(0.97, 1.0, sunDot) * 0.5;
                col += _SunColor.rgb * (disc + glow);

                return half4(col, 1);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
