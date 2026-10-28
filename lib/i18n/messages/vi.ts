import extra from "./vi-extra.json";
import base from "./vi-base.json";

export default { ...extra, ...base } as Readonly<Record<string, string>>;
