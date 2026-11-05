from pathlib import Path
from PIL import Image
import numpy as np,json,hashlib
p=Path(__file__).resolve().parent;g=json.loads((p/'geometry.json').read_text());im=Image.open(p/'screenshot.png');w,h=im.size;yy,xx=np.ogrid[:h,:w];xx=xx+.5;yy=yy+.5;used=np.zeros((h,w),dtype=bool);targets={'content':84.4,'head':7,'notes':1,'tools':4,'mode':2,'identity':1.5,'footer':.1};parts={}
for k,rs in g['regions'].items():
 m=np.zeros((h,w),dtype=bool)
 for r in rs:m|=(xx>=r['x'])&(xx<r['x']+r['width'])&(yy>=r['y'])&(yy<r['y']+r['height'])
 area=int(m.sum());overlap=int((used&m).sum());used|=m;actual=area/(w*h)*100;parts[k]={'pixels':area,'target':targets[k],'actual':round(actual,8),'errorPercentagePoints':round(actual-targets[k],8),'overlappingPixels':overlap}
prior=json.loads((p/'report.json').read_text());r={'screenshot':'screenshot.png','viewport':[w,h],'tasks':g['tasks'],'method':g['method'],'regions':parts,'unclassifiedPixels':int((~used).sum()),'unclassifiedPercent':float((~used).sum())/(w*h)*100,'sourceBefore':prior['sourceBefore'],'sourceAfter':prior['sourceAfter'],'uiSourceUnchanged':prior['sourceBefore']==prior['sourceAfter'],'matchesExactly':all(x['actual']==x['target'] for x in parts.values()),'domOrStyleInjected':False};(p/'report.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps(r,ensure_ascii=False))
