// 阴影贴图（深度）通道：只写深度，供主通道 PCF 采样
export const shadowVert = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * vec4(aPos, 1.0); }
`;

export const shadowFrag = /* glsl */ `#version 300 es
precision highp float;
out vec4 frag;
void main() { frag = vec4(1.0); }
`;
