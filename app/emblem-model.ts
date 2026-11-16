const vertexShader = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUV;
  attribute float aSurface;
  uniform vec2 uAngle;
  uniform vec2 uScale;
  varying vec3 vNormal;
  varying vec2 vUV;
  varying float vSurface;

  vec3 rotate(vec3 p) {
    float cx = cos(uAngle.x), sx = sin(uAngle.x);
    float cy = cos(uAngle.y), sy = sin(uAngle.y);
    vec3 q = vec3(p.x, cx*p.y - sx*p.z, sx*p.y + cx*p.z);
    return vec3(cy*q.x + sy*q.z, q.y, -sy*q.x + cy*q.z);
  }

  void main() {
    vec3 p = rotate(aPosition);
    vNormal = rotate(aNormal);
    vUV = aUV;
    vSurface = aSurface;
    gl_Position = vec4(p.xy * uScale, -p.z * .3, 1.0 - .24 * p.z);
  }
`;

const fragmentShader = `
  precision mediump float;
  uniform sampler2D uLogo;
  varying vec3 vNormal;
  varying vec2 vUV;
  varying float vSurface;

  void main() {
    vec3 n = normalize(vNormal);
    float highlight = pow(max(0., dot(n, normalize(vec3(-.35,.68,.6)))), 14.);
    float broad = abs(dot(n, normalize(vec3(.3,.9,.35))));
    float strip = smoothstep(.79,.96,broad);
    float red = pow(max(0., dot(n, normalize(vec3(.8,-.35,.4)))), 5.);
    if (vSurface < .5) {
      vec3 logo = texture2D(uLogo,vUV).rgb;
      gl_FragColor = vec4(logo * (.88 + .12 * max(0.,n.z)) + highlight * .035,1.);
    } else {
      vec3 metal = vec3(.09,.091,.105) + vec3(.39,.41,.45) * strip + highlight * .52;
      if (vSurface > 1.5) metal = vec3(.25,.014,.023) + vec3(.66,.022,.035) * red + strip * .17;
      gl_FragColor = vec4(metal + vec3(.33,.025,.04) * red, 1.);
    }
  }
`;

function mesh() {
  const points: number[] = [];
  const segments = 112;
  const front = .074, back = -.105;
  function vertex(radius:number, angle:number, depth:number, normalZ:number, surface:number) {
    const x = radius*Math.cos(angle), y = radius*Math.sin(angle);
    const slope = Math.sqrt(1-normalZ*normalZ);
    points.push(x,y,depth,Math.cos(angle)*slope,Math.sin(angle)*slope,normalZ,.5+x*.476,.5+y*.476,surface);
  }
  // Radius and depth of each step in the machined edge.
  const profile = [[.993,front,1],[1.008,.048,.55],[1.008,.033,0],[1.01,.024,0],
    [1.01,-.041,0],[1.008,-.05,0],[1.008,-.083,0],[.985,back,-.55]];
  for (let i=0;i<segments;i++) {
    const a=i*2*Math.PI/segments, b=(i+1)*2*Math.PI/segments;
    vertex(0,0,front,1,0);
    vertex(.993,a,front,1,0);
    vertex(.993,b,front,1,0);
    vertex(0,0,back,-1,1);
    vertex(.985,b,back,-1,1);
    vertex(.985,a,back,-1,1);
    for (let j=1;j<profile.length;j++) {
      const [r1,z1,n1]=profile[j-1], [r2,z2,n2]=profile[j];
      const surface=j===4?2:1;
      vertex(r1,a,z1,n1,surface); vertex(r2,a,z2,n2,surface); vertex(r2,b,z2,n2,surface);
      vertex(r1,a,z1,n1,surface); vertex(r2,b,z2,n2,surface); vertex(r1,b,z1,n1,surface);
    }
  }
  return new Float32Array(points);
}

export function makeEmblem(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});
  if (!gl || gl.isContextLost()) return null;
  const program=gl.createProgram();
  const buffer=gl.createBuffer();
  const texture=gl.createTexture();
  if (!program || !buffer || !texture) return null;
  const shaders: WebGLShader[]=[];
  function cleanup() {
    if (!gl) return;
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  }
  for (const [kind,source] of [[gl.VERTEX_SHADER,vertexShader],[gl.FRAGMENT_SHADER,fragmentShader]] as const) {
    const shader=gl.createShader(kind);
    if (!shader) {cleanup();return null;}
    shaders.push(shader);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {cleanup();return null;}
    gl.attachShader(program,shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {cleanup();return null;}
  gl.useProgram(program);
  const points=mesh();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,points,gl.STATIC_DRAW);
  const attributes = [['aPosition',3,0],['aNormal',3,3],['aUV',2,6],['aSurface',1,8]] as const;
  for (const [name,size,offset] of attributes) {
    const location=gl.getAttribLocation(program,name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location,size,gl.FLOAT,false,36,offset*4);
  }
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0,0,0,0);
  const angle=gl.getUniformLocation(program,'uAngle');
  const scale=gl.getUniformLocation(program,'uScale');
  const draw=(x:number,y:number)=>{
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const width=Math.round(canvas.clientWidth*ratio), height=Math.round(canvas.clientHeight*ratio);
    if (!width || !height) return;
    if (canvas.width!==width || canvas.height!==height) {
      canvas.width=width;
      canvas.height=height;
    }
    gl.viewport(0,0,width,height);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const fit=Math.min(width,height)*.91;
    gl.uniform2f(scale,fit/width,fit/height);
    gl.uniform2f(angle,x,y);
    gl.drawArrays(gl.TRIANGLES,0,points.length/9);
  };
  return {draw,cleanup};
}
