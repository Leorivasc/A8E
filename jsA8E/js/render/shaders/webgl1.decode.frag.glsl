precision mediump float;
uniform sampler2D u_indexTex;
uniform sampler2D u_paletteTex;
uniform sampler2D u_vbxeTex;
uniform sampler2D u_vbxeHiresTex;
uniform vec2 u_viewOrigin;
uniform vec2 u_viewSize;
varying vec2 v_uv;
void main(){
  float idx = floor(texture2D(u_indexTex, v_uv).r * 255.0 + 0.5);
  float u = (idx + 0.5) / 256.0;
  vec4 vbxe = texture2D(u_vbxeTex, v_uv);
  vec4 vbxeHires = texture2D(u_vbxeHiresTex, (v_uv - u_viewOrigin) / u_viewSize);
  gl_FragColor = vbxeHires.a > 0.0 ? vbxeHires : (vbxe.a > 0.0 ? vbxe : texture2D(u_paletteTex, vec2(u, 0.5)));
}
