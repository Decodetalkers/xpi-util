import * as fs from "@std/fs";
import { BlobReader, type Entry, TextWriter, ZipReader } from "@zip-js/zip-js";

export type AddonInfo = {
  id: string;
  name: string;
  version: string;
};

export class Result<T> {
  private inner_data?: T;
  private error?: Error;
  private constructor() {}
  static from_error<T>(error: Error): Result<T> {
    const result = new Result<T>();
    result.error = error;
    return result;
  }
  static from_data<T>(data: T): Result<T> {
    const result = new Result<T>();
    result.inner_data = data;
    return result;
  }
  public is_ok(): boolean {
    return this.inner_data !== undefined;
  }
  public is_err(): boolean {
    return this.error != undefined;
  }
  public data(): T | undefined {
    return this.inner_data;
  }
  public err(): Error | undefined {
    return this.error;
  }
}

/// read the xpi file and get the data
export async function readXpiInfo(
  addonPath: string,
): Promise<Result<AddonInfo>> {
  if (!(await fs.exists(addonPath))) {
    return Result.from_error(new Error(`path ${addonPath} does not exist`));
  }
  const fileData = await Deno.readFile(addonPath);
  const zipFileBlob: Blob = new Blob([fileData]);
  const zipFileReader = new BlobReader(zipFileBlob);

  const zipReader = new ZipReader(zipFileReader);
  const entries: Entry[] = await zipReader.getEntries();
  const jsonEntry: Entry | undefined = entries.find((entry) =>
    entry.filename == "manifest.json"
  );
  if (!jsonEntry) {
    return Result.from_error(new Error("do not contain manifest.json"));
  }
  const jsonWriter = new TextWriter();
  const doc = await jsonEntry.getData!(jsonWriter);
  await zipReader.close();
  const webExtManifest = JSON.parse(doc);
  const details = {
    id: "",
    name: "",
    version: "",
  };
  details.id = (
    (webExtManifest.browser_specific_settings || {}).gecko || {}
  ).id;
  if (!details.id) {
    details.id = ((webExtManifest.applications || {}).gecko || {})
      .id as string;
  }
  details.name = webExtManifest.name;
  details.version = webExtManifest.version;
  return Result.from_data(details);
}

/// parse the json
export async function parseExtManifest(
  path: string,
): Promise<Result<AddonInfo>> {
  if (!(await fs.exists(path))) {
    return Result.from_error(new Error(`path ${path} does not exist`));
  }
  const data = Deno.readFileSync(path);
  const decode = new TextDecoder();
  const doc = decode.decode(data);
  const webExtManifest = JSON.parse(doc);
  const details = {
    id: "",
    name: "",
    version: "",
  };
  details.id = (
    (webExtManifest.browser_specific_settings || {}).gecko || {}
  ).id;
  if (!details.id) {
    details.id = ((webExtManifest.applications || {}).gecko || {})
      .id as string;
  }
  details.name = webExtManifest.name;
  details.version = webExtManifest.version;
  return Result.from_data(details);
}
