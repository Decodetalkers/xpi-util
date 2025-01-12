import * as fs from "@std/fs";
import {
  BlobReader,
  BlobWriter,
  type Entry,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
  ZipWriter,
} from "@zip-js/zip-js";
import * as path from "@std/path";
import { walk } from "@std/fs/walk";

export type AddonInfo = {
  id: string;
  name: string;
  version: string;
};

export type ExtInfo = {
  type: "dir" | "xpi";
  info: AddonInfo;
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

function isValidAOMAddonId(s: string) {
  return /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-\._]*\@[a-z0-9-\._]+)$/i
    .test(
      s || "",
    );
}

export function getID(manifest: AddonInfo): string | undefined {
  if (manifest.id) {
    return isValidAOMAddonId(manifest.id) ? manifest.id : undefined;
  }

  // This is currently used to keep the backward compatible behavior
  // expected on the deprecated jetpack extensions manifest file.
  if (manifest.name) {
    const id = `@${manifest.name}`;
    return isValidAOMAddonId(id) ? id : undefined;
  }

  return undefined;
}

export async function readExtInfo(
  addonPath: string,
  textDecoder?: TextDecoder,
): Promise<Result<ExtInfo>> {
  const isDir = (await Deno.stat(addonPath)).isDirectory;
  let type = "file";
  if (isDir) {
    type = "dir";
  }
  const result = { type, info: {} };
  const decoder = textDecoder || new TextDecoder();
  let doc: string;
  if (isDir) {
    const json_path = path.join(addonPath, "manifest.json");
    const data = Deno.readFileSync(json_path);
    doc = decoder.decode(data);
  } else {
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
    doc = await jsonEntry.getData!(jsonWriter);
    await zipReader.close();
  }
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
  result.info = details;
  return Result.from_data(result as ExtInfo);
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
  textDecoder?: TextDecoder,
): Promise<Result<AddonInfo>> {
  if (!(await fs.exists(path))) {
    return Result.from_error(new Error(`path ${path} does not exist`));
  }
  const data = Deno.readFileSync(path);
  const decoder = textDecoder || new TextDecoder();
  const doc = decoder.decode(data);
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

export type XpiInfo = {
  zipFileWriter: BlobWriter;
  id: string;
};

export async function packageXpi(
  sourceDir: string,
  textDecoder?: TextDecoder,
  targetFolder?: string,
) {
  const zipFileWriter: BlobWriter = new BlobWriter();

  const zipWriter = new ZipWriter(zipFileWriter);
  for await (const fileEntry of walk(sourceDir)) {
    if (!fileEntry.isFile) {
      continue;
    }
    const data = await Deno.readFile(fileEntry.path);
    const dataReader = new Uint8ArrayReader(data);
    const zippath = path.relative(sourceDir, fileEntry.path);
    await zipWriter.add(zippath, dataReader);
  }
  zipWriter.close();
  const info_result = await readExtInfo(sourceDir, textDecoder);
  if (info_result.is_err()) {
    return;
  }
  const info = info_result.data()!.info;
  const fileNamePre = getID(info);
  if (!fileNamePre) {
    return;
  }
  const fileName = fileNamePre + ".xpi";
  const target = path.join(targetFolder || Deno.cwd(), fileName);
  const zipFileBlob: Blob = await zipFileWriter.getData();

  await Deno.writeFile(target, zipFileBlob.stream());
}
