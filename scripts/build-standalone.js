// www/chem.html + www/chem-core.js → standalone/molecule-viewer.html (파일 하나로 열리는 버전)
// 실행: node scripts/build-standalone.js
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "www/chem.html"), "utf8");
const core = fs.readFileSync(path.join(root, "www/chem-core.js"), "utf8");
const tag = '<script src="chem-core.js"></script>';
const back = '    <a class="btn" href="index.html">← 실험실</a>\n';
if (!html.includes(tag) || !html.includes(back)) throw new Error("chem.html 구조가 바뀌었어요. 빌드 스크립트를 확인하세요.");
if (/<\/script/i.test(core)) throw new Error("chem-core.js 안에 </script>가 있어 인라인할 수 없어요.");
html = html.replace(tag, () => "<script>\n" + core + "</script>").replace(back, "");
fs.mkdirSync(path.join(root, "standalone"), { recursive: true });
fs.writeFileSync(path.join(root, "standalone/molecule-viewer.html"), html);
console.log("standalone/molecule-viewer.html", (html.length / 1024).toFixed(0) + " KB");
