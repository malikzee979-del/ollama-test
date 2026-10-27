// Minimal unlit, vertex-colored, textured, depth-writing shader.
// Lives in Resources/ so it is ALWAYS included in player builds — the
// project generates every material in code, and Unity strips shaders that
// no serialized asset references (Standard would come out magenta).
// "Lighting" is baked into vertex colors by the mesh builders.
Shader "LTA/Opaque"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Tint", Color) = (1,1,1,1)
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        Pass
        {
            ZWrite On
            Cull Back
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            // Global day/night tint, set once per frame from GameLoop via
            // Shader.SetGlobalColor — not a material property, so every
            // instance of this shader picks it up without per-material work.
            fixed4 _LtaDayNight;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                fixed4 color : COLOR;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                fixed4 color : COLOR;
            };

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.color = v.color * _Color;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 c = tex2D(_MainTex, i.uv) * i.color;
                c.rgb *= _LtaDayNight.rgb;
                return c;
            }
            ENDCG
        }
    }
}
