import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  createTranslator,
  parseLanguage,
  languageCookie,
} from "../lib/i18n/language.ts";
const root = resolve(import.meta.dirname, "..");
function dictionary(locale) {
  const file = resolve(root, "lib/i18n/messages/" + locale + ".ts");
  let out = {};
  for (const match of readFileSync(file, "utf8").matchAll(
    /import (\w+) from "([^"]+\.json)"/g,
  )) {
    out = {
      ...out,
      ...JSON.parse(readFileSync(resolve(dirname(file), match[2]), "utf8")),
    };
  }
  return out;
}
const en = dictionary("en"),
  vi = dictionary("vi");
test("language is Vietnamese by default and only explicit en opts into English", () => {
  for (const v of [
    undefined,
    null,
    "",
    "VI",
    "EN",
    "en-US",
    "fr",
    "en; Domain=x",
    {},
    true,
  ])
    assert.equal(parseLanguage(v), "vi");
  assert.equal(parseLanguage("en"), "en");
  assert.equal(parseLanguage("vi"), "vi");
  assert.equal(
    languageCookie("en", true),
    "medlabs-language=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
  );
  assert.ok(!languageCookie("vi").includes("Secure"));
});
test("interface copy renders one language while exact quantities and record content retain bytes", () => {
  const english = createTranslator(en),
    vietnamese = createTranslator(vi);
  const source = "Tên vật tư / Name";
  assert.equal(english(source), "Name");
  assert.equal(vietnamese(source), "Tên vật tư");
  const t = createTranslator({ "Phiếu {0}: {1}": "Request {0}: {1}" });
  assert.equal(
    t("Phiếu {0}: {1}", ["  An  Bình  ", "100000000000.000001"]),
    "Request   An  Bình  : 100000000000.000001",
  );
  assert.equal(
    t("Tên người dùng chưa có trong bảng dịch"),
    "Tên người dùng chưa có trong bảng dịch",
  );
  assert.equal(t("Phiếu  An  Bình: 0.000001"), "Request  An  Bình: 0.000001");
});
test("specific validation sentences take precedence over generic row and session wrappers", () => {
  const t = createTranslator(en);
  assert.equal(
    t("Dòng 1: Hệ số quy đổi phải lớn hơn 0."),
    "Row 1: Conversion factor must be greater than 0.",
  );
  assert.equal(
    t("Buổi 1: Ngày học phải nằm trong khoảng đăng ký."),
    "Session 1: Date must be within the registration period.",
  );
  assert.equal(t("Tài khoản của An"), "Account for An");
  assert.equal(
    t("Tạo hồ sơ nguồn A  B thành công!"),
    "Source record A  B created successfully!",
  );
});
test("translated templates reference existing arguments and preserve technical UI copy", () => {
  for (const [key, value] of Object.entries(en)) {
    const allowed = new Set([...key.matchAll(/\{(\d+)\}/g)].map((m) => m[1]));
    for (const m of value.matchAll(/\{(\d+)\}/g))
      assert.ok(allowed.has(m[1]), `${key}: invented parameter ${m[0]}`);
  }
  const t = createTranslator(en);
  for (const key of ["constructor", "toString", "__proto__"])
    assert.equal(t(key), key);
  assert.equal(t("S/N"), "S/N");
  assert.equal(t("Asia/Ho_Chi_Minh"), "Asia/Ho_Chi_Minh");
  assert.ok(Object.keys(en).length > 3000);
  assert.equal(
    createTranslator(vi)("Select a responsible lecturer"),
    "Chọn giảng viên phụ trách",
  );
});
test("calendar view identity stays independent from translated button labels", () => {
  const s = readFileSync(resolve(root, "components/dashboard.tsx"), "utf8");
  assert.match(s, /\(\["Tháng", "Tuần", "Danh sách"\] as View\[\]\)/);
  assert.match(s, /onClick=\{\(\) => navigateToView\(item\)\}/);
  assert.match(s, /\{uiText\(item\)\}/);
  assert.match(s, /Tháng: "month"/);
  assert.match(s, /Tuần: "week"/);
  assert.match(s, /"Danh sách": "list"/);
});
test("translated option labels never become implicit submitted values", () => {
  const files = ts.sys.readDirectory(
    root,
    [".tsx"],
    ["node_modules", ".next", ".git"],
    ["app/**/*.tsx", "components/**/*.tsx"],
  );
  for (const file of files) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(n) {
      if (
        ts.isJsxElement(n) &&
        n.openingElement.tagName.getText(sf) === "option"
      ) {
        assert.ok(
          n.openingElement.attributes.properties.some(
            (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "value",
          ),
          `${file}: option needs an explicit value`,
        );
      }
      ts.forEachChild(n, visit);
    }
    visit(sf);
  }
});

test("nested validator messages select one language without translating an item name", () => {
  const error = "Số lượng nhập phải lớn hơn 0 / Purchase quantity must be > 0";
  assert.equal(
    createTranslator(en)(`Dòng Kho: ${error}`),
    "Row Kho: Purchase quantity must be > 0",
  );
  assert.equal(
    createTranslator(vi)(`Dòng Kho: ${error}`),
    "Dòng Kho: Số lượng nhập phải lớn hơn 0",
  );
  assert.equal(
    createTranslator(en)("Dòng {0}: {1}", ["Kho", error]),
    "Row Kho: Purchase quantity must be > 0",
  );
});
