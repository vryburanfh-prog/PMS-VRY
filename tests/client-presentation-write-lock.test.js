const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
function bodyFor(name){const m=source.match(new RegExp('function '+name+'\\([^)]*\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}'));assert.ok(m,name+' exists');return m[0];}
test('client presentation persistence is serialized without locking AI generation',()=>{
 const body=bodyFor('apiGenerateClientPresentation');
 const ai=body.indexOf('generateAiSlideDeckWithGemini_(');
 const lock=body.indexOf('LockService.getScriptLock()');
 const wait=body.indexOf('writeLock.waitLock(15000)');
 const ensure=body.indexOf('ensureClientPresentationsSheet_()');
 const append=body.indexOf('sh.appendRow(');
 const release=body.indexOf('writeLock.releaseLock()');
 assert.ok(ai>=0&&lock>ai,'external AI deck generation occurs before lock');
 assert.ok(wait>lock&&ensure>wait&&append>ensure,'sheet initialization and append protected');
 assert.ok(release>append,'release after append');
 assert.match(body,/finally\s*\{[\s\S]*?writeLock\.releaseLock\(\);?\s*\}/);
 assert.match(body,/DECK-[\s\S]*Math\.floor\(1000\s*\+\s*Math\.random\(\)\s*\*\s*9000\)/,'deck IDs add a collision-resistant suffix');
});
test('database template copy name includes collision-resistant suffix',()=>{
 const body=bodyFor('apiCreateDatabaseTemplateCopy');
 assert.match(body,/yyyyMMdd_HHmmss[\s\S]*Math\.floor\(1000\s*\+\s*Math\.random\(\)\s*\*\s*9000\)/);
});
