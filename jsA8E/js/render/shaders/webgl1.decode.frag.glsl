precision mediump float;
uniform sampler2D u_indexTex;
uniform sampler2D u_paletteTex;
uniform sampler2D u_vbxeTex;
varying vec2 v_uv;
void main(){
  float idx = floor(texture2D(u_indexTex, v_uv).r * 255.0 + 0.5);
  float u = (idx + 0.5) / 256.0;
  vec4 vbxe = texture2D(u_vbxeTex, v_uv);
  gl_FragColor = vbxe.a > 0.0 ? vbxe : texture2D(u_paletteTex, vec2(u, 0.5));
}
