// URP lit shader for the whole city.
//
// Ported from the built-in-pipeline version written earlier this session.
// Keeps the same shape — vertex-color albedo, hemisphere ambient, Blinn-Phong
// specular, night window emission — but adds the thing the migration was for:
// an additional-lights loop, so street lamps and headlights can be REAL
// lights. Built-in forward capped out at a handful of per-pixel lights per
// object; Forward+ clusters them, so a street of lamps is affordable.
//
// Passes:
//   ForwardLit   main shading
//   ShadowCaster so geometry casts (directional + punctual)
//   DepthOnly    depth prepass
//   DepthNormals SSAO's default source
//
// Lives in Resources/ because every material is generated in code, so
// nothing else would keep it alive through a player build.
Shader "LTA/Lit"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Tint", Color) = (1,1,1,1)
        _Gloss ("Gloss", Range(0,1)) = 0.12
        _SpecStrength ("Specular Strength", Range(0,3)) = 0.20
        // Phase 10: 0 = dielectric (concrete, asphalt, glass), 1 = metal
        // (car paint sits low-but-nonzero, chrome trim high). Drives both the
        // Fresnel F0 and how much energy leaves the diffuse term.
        _Metallic ("Metallic", Range(0,1)) = 0.0
        // Phase 11: height field in R, NOT a tangent-space normal map. The
        // normal is perturbed from screen-space derivatives (see
        // LtaBumpNormal) because no mesh in this project has tangents.
        // Defaults to black + scale 0, so any material that does not opt in
        // is bit-identical to before.
        _BumpMap ("Height (R)", 2D) = "black" {}
        _BumpScale ("Height scale", Range(0,4)) = 0.0
        _EmissThreshold ("Emissive luminance threshold", Range(0,1)) = 0.34
        _EmissStrength ("Emissive strength", Range(0,4)) = 0.0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                half4  _Color;
                half   _Gloss;
                half   _SpecStrength;
                half   _Metallic;
                half   _BumpScale;
                half   _EmissThreshold;
                half   _EmissStrength;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);
            TEXTURE2D(_BumpMap);
            SAMPLER(sampler_BumpMap);

            // ---- Phase 11: derivative bump mapping -------------------------
            // Mikkelsen's surface-gradient method for unparameterised
            // surfaces. Used instead of a tangent-space normal map because
            // MB.Build() writes positions, colours, UVs, triangles, normals
            // and bounds — and no tangents. RecalculateTangents() across every
            // procedurally generated mesh in the city each frame is not
            // affordable, and the hand-built meshes would need it too.
            //
            // This needs nothing but the world position (already interpolated)
            // and the height sample, both of which we have. Cost is four
            // derivative instructions, which the GPU computes per 2x2 quad
            // anyway.
            half3 LtaBumpNormal(half3 N, float3 posWS, half height, half scale)
            {
                if (scale <= 0.0h) return N;

                float3 dpx = ddx(posWS);
                float3 dpy = ddy(posWS);
                half   dhx = ddx(height);
                half   dhy = ddy(height);

                float3 r1 = cross(dpy, N);
                float3 r2 = cross(N, dpx);
                float  det = dot(dpx, r1);

                float3 grad = sign(det) * (dhx * r1 + dhy * r2);
                return normalize(abs(det) * N - scale * grad);
            }

            // ---- Phase 10: GGX specular ------------------------------------
            // Replaces the Blinn-Phong lobe this shader shipped with. Three
            // reasons it matters more than the highlight shape:
            //   * Fresnel. Schlick's term brightens every surface at grazing
            //     angles. That is the single strongest "wet asphalt / real
            //     glass" cue, and the old lobe had none of it at all.
            //   * Energy. GGX is normalised, so a rough surface spreads the
            //     same energy rather than simply getting a fatter highlight.
            //   * Metals. F0 tinted by albedo is what makes car paint and
            //     chrome read as metal instead of shiny plastic.
            // Smith visibility uses Filament's fast correlated approximation —
            // two mads cheaper than the exact form, indistinguishable here.
            half3 LtaSpecGGX(half3 N, half3 V, half3 L, half3 lightColor,
                             half roughness, half3 F0)
            {
                half3 H = normalize(L + V);
                half NoH = saturate(dot(N, H));
                half NoV = saturate(dot(N, V)) + 1e-4h;
                half NoL = saturate(dot(N, L));
                half LoH = saturate(dot(L, H));

                half a  = max(roughness * roughness, 1e-3h);
                half a2 = a * a;
                half d  = (NoH * a2 - NoH) * NoH + 1.0h;
                half D  = a2 / max(3.14159265h * d * d, 1e-5h);

                half ggxV = NoL * (NoV * (1.0h - a) + a);
                half ggxL = NoV * (NoL * (1.0h - a) + a);
                half Vis  = 0.5h / max(ggxV + ggxL, 1e-5h);

                half3 F = F0 + (1.0h - F0) * pow(1.0h - LoH, 5.0h);

                return lightColor * (D * Vis * NoL) * F;
            }

            // globals, set once per frame from GameLoop.UpdateWorldFX
            half4 _LtaDayNight;      // overall day/night tint
            half4 _LtaAmbSky;        // hemisphere ambient, upward facing
            half4 _LtaAmbGround;     // hemisphere ambient, downward facing
            half  _LtaNightEmission; // 0 by day -> 1 at night
            half  _LtaReflBlend;     // Phase 12: 0 = hemisphere fake, 1 = probe cubemap

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
                half4  color      : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3  normalWS   : TEXCOORD2;
                float  fogCoord   : TEXCOORD3;
                half4  color      : COLOR;
            };

            Varyings vert (Attributes IN)
            {
                Varyings OUT = (Varyings)0;
                VertexPositionInputs pos = GetVertexPositionInputs(IN.positionOS.xyz);
                VertexNormalInputs   nrm = GetVertexNormalInputs(IN.normalOS);
                OUT.positionCS = pos.positionCS;
                OUT.positionWS = pos.positionWS;
                OUT.normalWS   = nrm.normalWS;
                OUT.uv         = TRANSFORM_TEX(IN.uv, _MainTex);
                OUT.color      = IN.color * _Color;
                OUT.fogCoord   = ComputeFogFactor(pos.positionCS.z);
                return OUT;
            }

            half4 frag (Varyings IN) : SV_Target
            {
                half4 albedo = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, IN.uv) * IN.color;

                half3 N = normalize(IN.normalWS);
                half3 V = normalize(GetWorldSpaceViewDir(IN.positionWS));

                // Phase 11: perturb the flat facet normal by the baked height
                // field before anything reads N. This is what stops a window
                // reveal, a cornice and a kerb from being painted-on lines —
                // they now catch the moon and the street lamps on one edge and
                // shade on the other. No-ops when _BumpScale is 0.
                half bumpH = SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, IN.uv).r;
                N = LtaBumpNormal(N, IN.positionWS, bumpH, _BumpScale);

                // InputData also feeds the Forward+ cluster loop, which reads
                // positionWS and normalizedScreenSpaceUV off it by name.
                InputData inputData = (InputData)0;
                inputData.positionWS = IN.positionWS;
                inputData.normalWS = N;
                inputData.viewDirectionWS = V;
                inputData.shadowCoord = TransformWorldToShadowCoord(IN.positionWS);
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(IN.positionCS);

                // hemisphere ambient: sky overhead, bounce below
                half3 amb = lerp(_LtaAmbGround.rgb, _LtaAmbSky.rgb, saturate(N.y * 0.5 + 0.5));
                #if defined(_SCREEN_SPACE_OCCLUSION)
                    AmbientOcclusionFactor ao = GetScreenSpaceAmbientOcclusion(inputData.normalizedScreenSpaceUV);
                    amb *= ao.indirectAmbientOcclusion;
                #endif

                // Phase 10: gloss is authored as smoothness, so roughness is
                // its complement. Clamped off zero — a perfectly smooth GGX
                // lobe is a singularity and fireflies under bloom.
                half roughness = max(1.0h - _Gloss, 0.045h);
                // Dielectrics reflect ~4% head-on; metals reflect their own
                // albedo. Same lerp every PBR renderer uses.
                half3 F0 = lerp(half3(0.04h, 0.04h, 0.04h), albedo.rgb, _Metallic);
                // Metals have no diffuse lobe at all.
                half3 diffAlbedo = albedo.rgb * (1.0h - _Metallic);
                half  NoV = saturate(dot(N, V));

                // Realism pass: fake sky sheen. Cheap stand-in for a
                // reflection probe — same hemisphere ambient colors, but
                // looked up by the reflection vector's Y instead of the
                // normal's, so glossy car paint/glass gets a moving
                // highlight as it turns relative to camera/sky, on top of
                // the flat ambient term below. Only visible where gloss
                // is high (car paint, glass) since it's weighted by _Gloss.
                half3 R = reflect(-V, N);
                half3 sheen = lerp(_LtaAmbGround.rgb, _LtaAmbSky.rgb, saturate(R.y * 0.5 + 0.5));

                // Phase 12: a REAL reflection, where one is available.
                // unity_SpecCube0 is whatever probe the renderer has bound for
                // this object — the realtime probe GameLoop parents to the
                // player when close enough, otherwise the skybox fallback.
                // Sampled at a roughness-derived mip so a matte wall gets the
                // blurred cube and car paint gets the sharp one.
                //
                // _LtaReflBlend is a global kill switch driven from
                // GameLoop.StepReflectionProbe: 0 falls all the way back to
                // the Phase 2 hemisphere fake, which is what happens if the
                // probe is disabled for performance.
                half  reflMip = PerceptualRoughnessToMipmapLevel(roughness);
                half4 reflEnc = SAMPLE_TEXTURECUBE_LOD(unity_SpecCube0, samplerunity_SpecCube0, R, reflMip);
                half3 reflProbe = DecodeHDREnvironment(reflEnc, unity_SpecCube0_HDR);
                half3 env = lerp(sheen, reflProbe, saturate(_LtaReflBlend));

                // ---- main light (the moon) ----
                Light mainLight = GetMainLight(inputData.shadowCoord);
                half  ndotl = saturate(dot(N, mainLight.direction));
                half  atten = mainLight.distanceAttenuation * mainLight.shadowAttenuation;
                half3 diffuse = mainLight.color * ndotl * atten;
                half3 spec = LtaSpecGGX(N, V, mainLight.direction,
                                        mainLight.color * atten, roughness, F0)
                             * _SpecStrength;

                // ---- additional lights: street lamps, headlights, sirens ----
                #if defined(_ADDITIONAL_LIGHTS)
                    uint count = GetAdditionalLightsCount();
                    LIGHT_LOOP_BEGIN(count)
                        Light l = GetAdditionalLight(lightIndex, inputData.positionWS, half4(1, 1, 1, 1));
                        half la = l.distanceAttenuation * l.shadowAttenuation;
                        half ln = saturate(dot(N, l.direction));
                        diffuse += l.color * ln * la;
                        spec += LtaSpecGGX(N, V, l.direction, l.color * la,
                                           roughness, F0) * _SpecStrength;
                    LIGHT_LOOP_END
                #endif

                half3 lit = diffAlbedo * (amb + diffuse) + spec;

                // Phase 10: the fake sky sheen is now Fresnel-weighted rather
                // than gloss-squared. This is the part you actually see — a
                // real reflection is weakest head-on and strongest at glancing
                // angles, so wet road ahead of the car brightens as it
                // recedes, and glass catches the sky along its edges instead
                // of glowing uniformly. F0 head-on, rising toward the
                // surface's own smoothness at the silhouette.
                half3 envF = F0 + (max(half3(_Gloss, _Gloss, _Gloss), F0) - F0)
                                  * pow(1.0h - NoV, 5.0h);
                lit += sheen * envF;
                lit *= _LtaDayNight.rgb;

                // Lit windows glow on their own after dark. Added AFTER the
                // day/night tint so they are not dimmed by it.
                half lum  = dot(albedo.rgb, half3(0.299, 0.587, 0.114));
                half mask = smoothstep(_EmissThreshold, _EmissThreshold + 0.12, lum);
                half3 emiss = albedo.rgb * mask * _EmissStrength * _LtaNightEmission;

                half3 col = lit + emiss;
                col = MixFog(col, IN.fogCoord);
                return half4(col, albedo.a);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            ZWrite On
            ZTest LEqual
            Cull Back

            HLSLPROGRAM
            #pragma vertex shadowVert
            #pragma fragment shadowFrag
            #pragma target 3.0
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            float3 _LightDirection;
            float3 _LightPosition;

            struct SAttributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct SVaryings  { float4 positionCS : SV_POSITION; };

            SVaryings shadowVert(SAttributes IN)
            {
                SVaryings OUT;
                float3 posWS = TransformObjectToWorld(IN.positionOS.xyz);
                float3 nrmWS = TransformObjectToWorldNormal(IN.normalOS);

                #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                    float3 lightDirWS = normalize(_LightPosition - posWS);
                #else
                    float3 lightDirWS = _LightDirection;
                #endif

                float4 positionCS = TransformWorldToHClip(ApplyShadowBias(posWS, nrmWS, lightDirWS));
                #if UNITY_REVERSED_Z
                    positionCS.z = min(positionCS.z, UNITY_NEAR_CLIP_VALUE);
                #else
                    positionCS.z = max(positionCS.z, UNITY_NEAR_CLIP_VALUE);
                #endif
                OUT.positionCS = positionCS;
                return OUT;
            }

            half4 shadowFrag(SVaryings IN) : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }

            ZWrite On
            ColorMask R
            Cull Back

            HLSLPROGRAM
            #pragma vertex depthVert
            #pragma fragment depthFrag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct DAttributes { float4 positionOS : POSITION; };
            struct DVaryings  { float4 positionCS : SV_POSITION; };

            DVaryings depthVert(DAttributes IN)
            {
                DVaryings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                return OUT;
            }

            half4 depthFrag(DVaryings IN) : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }

            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex dnVert
            #pragma fragment dnFrag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct DNAttributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct DNVaryings  { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD0; };

            DNVaryings dnVert(DNAttributes IN)
            {
                DNVaryings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                return OUT;
            }

            half4 dnFrag(DNVaryings IN) : SV_Target
            {
                return half4(normalize(IN.normalWS), 0.0);
            }
            ENDHLSL
        }

        // Per-pixel motion. The shader shipped without this, which is why the
        // camera was stuck on SMAA and MotionBlur on CameraOnly: TAA, STP and
        // per-object motion blur all need to know where each pixel was last
        // frame, and with no MotionVectors pass URP has nothing to tell them
        // about the hundreds of cars, cops and pedestrians moving every frame.
        //
        // URP's own ObjectMotionVectors.hlsl does the work — it derives motion
        // from the renderer's previous object-to-world matrix, so it needs no
        // tangents (no mesh in this project has any) and no vertex history.
        Pass
        {
            Name "MotionVectors"
            Tags { "LightMode" = "MotionVectors" }
            ColorMask RG

            HLSLPROGRAM
            #pragma target 3.5

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            // This block must stay byte-identical to the UnityPerMaterial
            // CBUFFER in the ForwardLit pass. If two passes of one shader
            // disagree on that layout the SRP Batcher rejects the whole
            // shader, and m_UseSRPBatcher is on — so getting this wrong would
            // cost more performance than motion vectors could ever buy back.
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                half4  _Color;
                half   _Gloss;
                half   _SpecStrength;
                half   _Metallic;
                half   _BumpScale;
                half   _EmissThreshold;
                half   _EmissStrength;
            CBUFFER_END

            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ObjectMotionVectors.hlsl"
            ENDHLSL
        }
    }

    Fallback Off
}
