"""Record checksums for audited, vendored browser assets; does not download code."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
packages={
 'transformers':{'package':'@huggingface/transformers','version':'3.8.1','license':'Apache-2.0','source':'https://www.npmjs.com/package/@huggingface/transformers/v/3.8.1'},
 'onnxruntime-web':{'version':'1.22.0-dev.20250409-89f8206ba4','license':'MIT','source':'https://github.com/microsoft/onnxruntime'},
 'tesseract.js':{'version':'6.0.1','license':'Apache-2.0','source':'https://github.com/naptha/tesseract.js'},
 'tesseract.js-core':{'version':'6.1.2','license':'Apache-2.0','source':'https://github.com/naptha/tesseract.js-core'},
 'tessdata_fast':{'revision':'87416418657359cb625c412a48b6e1d6d41c29bd','license':'Apache-2.0','source':'https://github.com/tesseract-ocr/tessdata_fast'}
}
files=[]
for path in sorted((root/'vendor').rglob('*')):
 if path.is_file():files.append({'path':str(path.relative_to(root)),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(root/'vendor-manifest.json').write_text(json.dumps({'packages':packages,'files':files},ensure_ascii=False,indent=2)+'\n')
print('Recorded',len(files),'assets')
