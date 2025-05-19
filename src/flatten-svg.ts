import { program } from "@commander-js/extra-typings";
import * as fs from "fs";
import * as jsdom from "jsdom";
const { JSDOM } = jsdom;

const { input, output } = program
  .requiredOption("-i, --input <input>", "The input SVG file")
  .requiredOption("-o, --output <output>", "The input SVG file")
  .parse()
  .opts();

// 最初のSVGファイルを読み込む
const originalSvgContent = fs.readFileSync(input, "utf8");
const originalDom = new JSDOM(originalSvgContent, {
  contentType: "image/svg+xml"
});
const originalDocument = originalDom.window.document;

// `xlink:href` の値が `http://` または `https://` で始まる `<image>` 要素すべてに対して処理を行う
const imageElements = originalDocument.querySelectorAll(
  'image[xlink\\:href^="http://"], image[xlink\\:href^="https://"]'
);
const promises = Array.from(imageElements).map((imageElement) => {
  const xlinkHref = imageElement.getAttribute("xlink:href");
  if (!xlinkHref) {
    return;
  }
  return fetch(xlinkHref)
    .then((res) => res.text())
    .then((data) => {
      const externalDom = new JSDOM(data, { contentType: "image/svg+xml" });
      const externalDocument = externalDom.window.document;

      // 外部リソースのSVGを `<defs>` 内の `<g>` 要素として埋め込む
      const externalSvgId = xlinkHref.split("/")!.pop()!.split("?")[0];
      const externalSvgGroup = externalDocument
        .querySelector("svg")!
        .cloneNode(true);
      const defsElement = originalDocument.querySelector("defs");
      const newGroup = originalDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );
      newGroup.setAttribute("id", externalSvgId);
      newGroup.appendChild(externalSvgGroup);
      defsElement!.appendChild(newGroup);

      // 外部リソースの参照を `<use>` 要素に置き換える
      const useElement = originalDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "use"
      );
      useElement.setAttributeNS(
        "http://www.w3.org/1999/xlink",
        "xlink:href",
        `#${externalSvgId}`
      );
      const parentElement = imageElement.parentNode;
      const p = parentElement as Element;
      p.setAttribute("x", "0");
      p.setAttribute("y", "0");
      p.setAttribute("width", imageElement.getAttribute("width")!);
      p.setAttribute("height", imageElement.getAttribute("height")!);
      parentElement!.replaceChild(useElement, imageElement);

      // `<use>` タグに置き換えた要素の親要素の `style` 属性を削除
      (parentElement as Element).removeAttribute("style");
      return;
    })
    .catch((err) => {
      console.error(`Error fetching ${xlinkHref}: ${err.message}`);
    });
});

Promise.all(promises)
  .then(() => {
    // 結果を出力する
    const result = originalDocument.documentElement.outerHTML;
    fs.writeFileSync(output, result);
    return;
  })
  .catch((err) => {
    console.error("Error:", err);
  });
