import assert from "node:assert/strict";
import test from "node:test";
import { backgroundImageDimensions, backgroundOutputDimensions, detectBackgroundImage, MAX_BACKGROUND_LONG_EDGE, prepareBackgroundImage } from "./background-theme.ts";

function png(width:number,height:number){const b=new Uint8Array(33);b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);b.set(new TextEncoder().encode("IHDR"),12);new DataView(b.buffer).setUint32(16,width);new DataView(b.buffer).setUint32(20,height);return b;}
function webp(width:number,height:number){const b=new Uint8Array(30);b.set(new TextEncoder().encode("RIFF"));b.set(new TextEncoder().encode("WEBP"),8);b.set(new TextEncoder().encode("VP8X"),12);const w=width-1,h=height-1;b.set([w&255,(w>>8)&255,(w>>16)&255,h&255,(h>>8)&255,(h>>16)&255],24);return b;}

test("accepts only real PNG/JPEG/WebP signatures and reads bounded source dimensions",()=>{
  assert.equal(detectBackgroundImage(png(4000,2000)),"image/png");assert.deepEqual(backgroundImageDimensions(png(4000,2000)),{width:4000,height:2000});
  assert.equal(detectBackgroundImage(webp(1200,800)),"image/webp");assert.deepEqual(backgroundImageDimensions(webp(1200,800)),{width:1200,height:800});
  const jpeg=new Uint8Array([0xff,0xd8,0xff,0xc0,0,11,8,0x03,0x20,0x04,0xb0,3,1,0x11,0,0xff,0xd9]);
  assert.equal(detectBackgroundImage(jpeg),"image/jpeg");assert.deepEqual(backgroundImageDimensions(jpeg),{width:1200,height:800});
  for(const bytes of [new Uint8Array(),new TextEncoder().encode("not an image"),new Uint8Array([0xff,0xd8,0,0])])assert.throws(()=>detectBackgroundImage(bytes),/background_invalid_type/);
});

test("preserves aspect ratio and color-capable raster size while rejecting decompression bombs",()=>{
  assert.deepEqual(backgroundOutputDimensions({width:4000,height:2000}),{width:MAX_BACKGROUND_LONG_EDGE,height:960});
  assert.deepEqual(backgroundOutputDimensions({width:800,height:1200}),{width:800,height:1200});
  for(const dimensions of [{width:0,height:1},{width:20000,height:1},{width:10000,height:10000}])assert.throws(()=>backgroundOutputDimensions(dimensions),/background_dimensions_too_large/);
});

test("uses oriented decoded dimensions and falls back to JPEG when WebP encoding is unavailable",async()=>{
  const jpeg=new Uint8Array([0xff,0xd8,0xff,0xc0,0,11,8,0x03,0x20,0x04,0xb0,3,1,0x11,0,0xff,0xd9]);
  const calls:string[]=[];
  const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob(callback:(blob:Blob|null)=>void,type:string){calls.push(type);callback(type==="image/webp"?null:new Blob(["encoded"],{type}));}} as unknown as HTMLCanvasElement;
  const result=await prepareBackgroundImage(new File([jpeg],"portrait.jpg",{type:"image/jpeg"}),{
    createBitmap:async()=>({width:800,height:1200,close(){}} as ImageBitmap),createCanvas:()=>canvas,toDataUrl:async blob=>`data:${blob.type};base64,ZW5jb2RlZA==`,now:()=>123,
  });
  assert.deepEqual(calls,["image/webp","image/jpeg"]);assert.equal(result.mime,"image/jpeg");assert.deepEqual({width:result.width,height:result.height},{width:800,height:1200});
});
