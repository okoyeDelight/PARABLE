from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, random, subprocess, os
import numpy as np

from pathlib import Path
OUT=os.environ.get('PARABLE_FILM_OUT','web/public/assets/parable-hero.mp4')
Path(OUT).parent.mkdir(parents=True,exist_ok=True)

W,H=1280,720
FPS=24
DUR=12
N=FPS*DUR
REG='/usr/share/fonts/truetype/croscore/Arimo-Regular.ttf'
BOLD='/usr/share/fonts/truetype/croscore/Arimo-Bold.ttf'

fonts={}
def F(size,bold=False):
    k=(size,bold)
    if k not in fonts: fonts[k]=ImageFont.truetype(BOLD if bold else REG,size)
    return fonts[k]

def clamp(x,a=0,b=1): return max(a,min(b,x))
def ease(x):
    x=clamp(x)
    return 4*x*x*x if x<.5 else 1-((-2*x+2)**3)/2

def lerp(a,b,t): return a+(b-a)*t

def mix(c1,c2,t): return tuple(int(lerp(a,b,t)) for a,b in zip(c1,c2))

def rr(draw,box,r,fill,outline=None,width=1): draw.rounded_rectangle(box,r,fill=fill,outline=outline,width=width)

def text(draw,xy,s,size,fill=(255,255,255),bold=False,anchor=None,spacing=4):
    draw.text(xy,s,font=F(size,bold),fill=fill,anchor=anchor,spacing=spacing)

def gradient_bg(c1=(6,7,11),c2=(12,13,20), glow=(55,69,190), gx=.53,gy=.46):
    y,x=np.mgrid[0:H,0:W]
    base=np.zeros((H,W,3),dtype=np.float32)
    for i in range(3): base[:,:,i]=np.linspace(c1[i],c2[i],H)[:,None]
    d=((x-W*gx)**2+(y-H*gy)**2)**0.5
    g=np.exp(-(d/(W*.36))**2)
    for i in range(3): base[:,:,i]+=g*glow[i]*.35
    return Image.fromarray(np.clip(base,0,255).astype('uint8'),'RGB').convert('RGBA')

def glow_circle(im,center,r,color,alpha=120,blur=50):
    lay=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(lay)
    d.ellipse((center[0]-r,center[1]-r,center[0]+r,center[1]+r),fill=(*color,alpha))
    lay=lay.filter(ImageFilter.GaussianBlur(blur)); return Image.alpha_composite(im,lay)

def panel(im,box,r=20,fill=(15,17,24,225),outline=(255,255,255,18),shadow=True):
    if shadow:
        s=Image.new('RGBA',im.size,(0,0,0,0)); sd=ImageDraw.Draw(s)
        b=(box[0],box[1]+12,box[2],box[3]+12); sd.rounded_rectangle(b,r,fill=(0,0,0,90)); s=s.filter(ImageFilter.GaussianBlur(18)); im=Image.alpha_composite(im,s)
    lay=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(lay); rr(d,box,r,fill,outline,1); return Image.alpha_composite(im,lay)

def topbar(im,phase,idx):
    d=ImageDraw.Draw(im)
    rr(d,(28,22,1252,76),16,(11,12,17,235),(255,255,255,16),1)
    rr(d,(44,35,72,63),8,(92,108,255,255)); text(d,(83,49),'PARABLE',15,(245,245,244),True,'lm')
    text(d,(1195,49),f'{idx+1:02d} / 06',11,(115,121,134),True,'rm')
    text(d,(1085,49),phase.upper(),10,(126,134,156),True,'rm')
    d.ellipse((1110,45,1117,52),fill=(118,235,179,255))
    return im

def progress(im,t):
    d=ImageDraw.Draw(im); d.rounded_rectangle((44,691,1236,695),2,fill=(255,255,255,18));
    x=44+(1236-44)*clamp(t/DUR); d.rounded_rectangle((44,691,x,695),2,fill=(105,128,255,255))

def scene_write(local):
    im=gradient_bg((5,6,10),(9,10,15),(58,72,210),.55,.48); im=glow_circle(im,(950,360),230,(57,71,205),80,65); im=topbar(im,'Write',0); d=ImageDraw.Draw(im)
    text(d,(64,118),'01  ·  WRITE',11,(119,126,148),True)
    text(d,(64,150),'Begin with the story,',48,(248,248,246),True)
    text(d,(64,204),'not the prompt.',48,(183,190,210),True)
    im=panel(im,(64,286,668,614),22,(13,15,21,235)); d=ImageDraw.Draw(im)
    text(d,(92,316),'MANUSCRIPT',10,(103,109,124),True); text(d,(92,348),'The Altar',28,(242,243,245),True)
    lines=['The room fell quiet.','Daniel looked at the empty chair across from him.','Outside, rain touched the windows like fingertips.']
    y=398
    reveal=int(1+local*4)
    for i,s in enumerate(lines):
        col=(230,232,238) if i==0 else (136,142,156)
        if i<reveal: text(d,(92,y),s,14,col,i==0)
        y+=38
    rr(d,(92,533,310,567),12,(16,24,48,255),(43,70,155,255),1); d.ellipse((106,546,114,554),fill=(100,132,255)); text(d,(124,550),'Story intelligence',11,(163,184,255),True,'lm')
    im=panel(im,(710,286,1216,614),22,(12,15,27,230)); d=ImageDraw.Draw(im)
    text(d,(740,316),'STORY CONTEXT',10,(101,109,130),True); text(d,(740,360),'“Outside, rain touched the windows',25,(242,243,245),True); text(d,(740,392),'like fingertips.”',25,(242,243,245),True)
    chips=['Awka, Nigeria','Present day','Faith drama','Young adults']
    cx,cy=740,470
    for c in chips:
        w=d.textlength(c,font=F(11,True))+28; rr(d,(cx,cy,cx+w,cy+36),18,(18,23,42,255),(46,66,132,255),1); text(d,(cx+14,cy+18),c,11,(166,181,235),True,'lm'); cx+=w+10
        if cx>1120: cx,cy=740,516
    return im

def scene_understand(local):
    im=gradient_bg((5,6,10),(9,10,16),(74,55,190),.5,.5); im=glow_circle(im,(640,390),240,(76,91,255),95,70); im=topbar(im,'Understand',1); d=ImageDraw.Draw(im)
    text(d,(64,118),'02  ·  UNDERSTAND',11,(119,126,148),True); text(d,(64,150),'PARABLE reads the world',46,(248,248,246),True); text(d,(64,202),'behind the words.',46,(183,190,210),True)
    cx,cy=640,420
    for r,a in [(190,28),(145,36),(100,48)]: d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(104,120,255,a),width=1)
    rr(d,(535,368,745,470),24,(15,18,34,245),(89,107,235,100),1); text(d,(640,407),'STORY',18,(245,246,249),True,'mm'); text(d,(640,436),'INTELLIGENCE',13,(155,170,235),True,'mm')
    nodes=[('CHARACTER','Daniel',(160,318)),('CONFLICT','Unanswered silence',(890,326)),('THEME','Surrender',(205,530)),('SETTING','Campus fellowship',(862,536)),('TONE','Intimate / restrained',(520,568))]
    for i,(a,b,(x,y)) in enumerate(nodes):
        q=clamp((local-.08*i)/.45)
        if q<=0: continue
        ex=x+150 if x<cx else x; ey=y+28; target=(535,419) if x<cx else (745,419)
        d.line((ex,ey,target[0],target[1]),fill=(86,104,225,int(90*q)),width=1)
        box=(x,y,x+250,y+58) if i<4 else (x,y,x+240,y+58)
        rr(d,box,15,(14,16,23,int(235*q)),(255,255,255,int(22*q)),1); text(d,(x+16,y+17),a,9,(101,108,126),True); text(d,(x+16,y+39),b,12,(215,218,227),True)
    return im

def scene_world(local):
    im=gradient_bg((5,6,10),(9,10,16),(41,75,155),.5,.5); im=topbar(im,'Shape the world',2); d=ImageDraw.Draw(im)
    text(d,(64,118),'03  ·  SHAPE THE WORLD',11,(119,126,148),True); text(d,(64,150),'Every story becomes',46,(248,248,246),True); text(d,(64,202),'a visual world.',46,(183,190,210),True)
    covers=[('Before I\nSaid Yes',(238,312),(-10),(241,111,158),(95,43,80)),('The\nAltar',(526,270),0,(94,111,255),(34,48,134)),('The\nWatchman',(836,312),10,(93,185,212),(35,88,107))]
    for j,(title,(x,y),ang,c1,c2) in enumerate(covers):
        bob=math.sin((local*2*math.pi)+j*1.3)*8; w,h=230,310
        lay=Image.new('RGBA',(w,h),(0,0,0,0)); arr=np.zeros((h,w,4),dtype=np.uint8)
        for yy in range(h):
            tt=yy/(h-1); c=mix(c1,c2,tt); arr[yy,:,0]=c[0];arr[yy,:,1]=c[1];arr[yy,:,2]=c[2];arr[yy,:,3]=255
        grad=Image.fromarray(arr,'RGBA'); lay=Image.alpha_composite(lay,grad); ld=ImageDraw.Draw(lay)
        rr(ld,(0,0,w-1,h-1),18,None,(255,255,255,42),1); text(ld,(18,24),'PARABLE ORIGINAL',9,(235,237,245),True)
        yy=205
        for line in title.split('\n'): text(ld,(18,yy),line,31,(255,255,255),True); yy+=34
        text(ld,(18,282),'STORY → SCREEN',9,(198,205,235),True)
        lay=lay.rotate(ang,resample=Image.Resampling.BICUBIC,expand=True)
        sh=Image.new('RGBA',im.size,(0,0,0,0)); box=(int(x-lay.width/2),int(y+bob-lay.height/2)); sh.paste(lay,(box[0]+8,box[1]+18),lay); sh=sh.filter(ImageFilter.GaussianBlur(14)); im=Image.alpha_composite(im,sh); im.alpha_composite(lay,(box[0],box[1]))
    return im

def scene_direct(local):
    im=gradient_bg((5,6,10),(9,10,16),(55,67,150),.45,.48); im=topbar(im,'Direct',3); d=ImageDraw.Draw(im)
    text(d,(64,118),'04  ·  DIRECT',11,(119,126,148),True); text(d,(64,150),'The story gets a director.',46,(248,248,246),True)
    x0,y0=64,250; sw=270; gap=16
    for i,label in enumerate(['01 · Establish','02 · Reaction','03 · Reveal']):
        x=x0+i*(sw+gap); im=panel(im,(x,y0,x+sw,y0+300),20,(12,14,21,238)); d=ImageDraw.Draw(im); gx=x+sw//2; gy=y0+135
        im=glow_circle(im,(gx,gy),80,((61,82,220) if i!=1 else (118,72,190)),65,28); d=ImageDraw.Draw(im); d.ellipse((gx-46,gy-46,gx+46,gy+46),fill=(31,36,64,190),outline=(97,111,190,80)); text(d,(x+18,y0+267),label,11,(170,176,193),True)
    im=panel(im,(940,250,1216,550),20,(13,15,22,244)); d=ImageDraw.Draw(im); text(d,(962,274),'AI DIRECTOR',10,(105,111,128),True)
    rows=[('SHOT','Slow push-in'),('LENS','50 mm'),('LIGHT','Window soft'),('PERFORMANCE','Held breath')]; yy=310
    for a,b in rows: text(d,(962,yy),a,9,(94,100,116),True); text(d,(962,yy+22),b,13,(223,225,232),True); d.line((962,yy+46,1192,yy+46),fill=(255,255,255,18)); yy+=54
    rr(d,(962,488,1192,533),12,(15,22,43,255),(39,61,130,255),1); text(d,(974,510),'Delay the reveal. Let the reaction land first.',10,(153,174,236),False,'lm')
    return im

def scene_cut(local):
    im=gradient_bg((5,6,10),(9,10,16),(50,82,142),.44,.48); im=topbar(im,'Cut',4); d=ImageDraw.Draw(im)
    text(d,(64,118),'05  ·  CUT',11,(119,126,148),True); text(d,(64,150),'Shape the rhythm.',46,(248,248,246),True); text(d,(64,202),'Keep the human beat.',46,(183,190,210),True)
    im=panel(im,(64,288,488,586),20,(12,14,21,242)); d=ImageDraw.Draw(im); rr(d,(88,315,464,516),14,(21,26,49,255)); im=glow_circle(im,(350,405),95,(74,95,230),65,32); d=ImageDraw.Draw(im)
    text(d,(108,463),'SCENE 07',10,(143,151,172),True); text(d,(108,490),'Silence becomes the turning point.',15,(238,239,243),True); text(d,(88,554),'EPISODE 01 · FINAL CUT',10,(104,110,126),True)
    im=panel(im,(520,288,1216,586),20,(10,12,17,244)); d=ImageDraw.Draw(im)
    tracks=[[(.05,.30,(21,34,77),'INT. ROOM'),(.32,.55,(49,24,46),'REACTION'),(.57,.92,(17,48,47),'REVEAL')],[(.08,.45,(17,48,47),'AMBIENCE'),(.47,.87,(21,34,77),'DIALOGUE')],[(.15,.78,(49,24,46),'SCORE')]]; yy=336
    for ti,tr in enumerate(tracks):
        text(d,(544,yy-16),['VIDEO','AUDIO','MUSIC'][ti],8,(85,91,105),True)
        for a,b,col,label in tr:
            x1=int(548+a*620);x2=int(548+b*620);rr(d,(x1,yy,x2,yy+48),7,(*col,255),(255,255,255,18),1); text(d,(x1+10,yy+24),label,9,(188,197,225),True,'lm')
        yy+=74
    px=int(548+(0.15+local*.72)*620); d.line((px,314,px,565),fill=(255,255,255,230),width=2); d.polygon([(px-5,314),(px+5,314),(px,322)],fill=(255,255,255,255))
    return im

def scene_final(local):
    im=gradient_bg((4,5,8),(8,9,13),(66,78,185),.5,.46); im=glow_circle(im,(640,350),210,(78,94,255),100,80); im=topbar(im,'Bring it to screen',5); d=ImageDraw.Draw(im)
    rr(d,(597,190,683,276),24,(92,109,255,255)); text(d,(640,233),'P',44,(255,255,255),True,'mm'); text(d,(640,345),'Stories made visible.',62,(250,250,248),True,'mm'); text(d,(640,405),'Write it. Direct it. Bring it to life.',22,(171,177,194),False,'mm'); rr(d,(498,462,782,514),16,(246,246,243,255)); text(d,(640,488),'PARABLE  ·  STORY → SCREEN',12,(13,14,18),True,'mm')
    return im

scenes=[scene_write,scene_understand,scene_world,scene_direct,scene_cut,scene_final]
base=[fn(.5).convert('RGB') for fn in scenes]
cmd=['ffmpeg','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',OUT]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for n in range(N):
    t=n/FPS; idx=min(5,int(t//2)); local=(t-idx*2)/2
    def camera(img, loc, direction=1):
        z=1.0+0.018*ease(loc); nw=int(W*z); nh=int(H*z); tmp=img.resize((nw,nh),Image.Resampling.LANCZOS); dx=int((nw-W)*(0.25+0.15*direction)); dy=int((nh-H)*0.48); return tmp.crop((dx,dy,dx+W,dy+H))
    cur=camera(base[idx],local,1 if idx%2==0 else -1)
    if local>.86 and idx<5:
        a=ease((local-.86)/.14); nxt=camera(base[idx+1],0,-1); cur=Image.blend(cur,nxt,a)
    dr=ImageDraw.Draw(cur); dr.rounded_rectangle((44,691,1236,695),2,fill=(34,35,42)); x=44+int((1236-44)*(t/DUR)); dr.rounded_rectangle((44,691,x,695),2,fill=(105,128,255)); p.stdin.write(cur.tobytes())
p.stdin.close(); p.wait(); print('rendered',os.path.getsize(OUT))
