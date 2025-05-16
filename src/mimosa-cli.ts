import { program } from "@commander-js/extra-typings";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { z } from "zod";
import { MiroBoard } from "./index.js";
import type { FrameBoardObject } from "./miro-types.ts";

const { token, inputJson } = program
  .option("-t, --token <token>", "Miro token")
  .requiredOption("-i, --input-json <inputJson>", "The input JSON file")
  .parse()
  .opts();

const inputJsonSchema = z.object({
  boardId: z.string(),
  outDir: z.string(),
  images: z.record(z.string())
});

const getCacheDifferences = (
  currentCache: { fname2hash: Record<string, string> },
  previousCache: { fname2hash: Record<string, string> }
) => {
  const currentKeys = Object.keys(currentCache.fname2hash);
  const previousKeys = Object.keys(previousCache.fname2hash);
  const addedKeys = currentKeys.filter((key) => !previousKeys.includes(key));
  const removedKeys = previousKeys.filter((key) => !currentKeys.includes(key));
  const modifiedKeys = currentKeys.filter((key) => {
    const currentHash = currentCache.fname2hash[key];
    const previousHash = previousCache.fname2hash[key];
    return previousKeys.includes(key) && currentHash !== previousHash;
  });
  return {
    addedKeys,
    removedKeys,
    modifiedKeys
  };
};

const txt = readFileSync(inputJson, "utf-8");
const { boardId, outDir, images } = inputJsonSchema.parse(JSON.parse(txt));

const getPreviousCache = () => {
  const cacheJsonSchema = z.object({
    fname2hash: z.record(z.string())
  });

  const cachePath = path.resolve(path.dirname(inputJson), outDir, "cache.json");

  try {
    const cacheJson = readFileSync(cachePath, "utf-8");
    return cacheJsonSchema.parse(JSON.parse(cacheJson));
  } catch {
    return { fname2hash: {} };
  }
};

(async () => {
  await using miroBoard = new MiroBoard({ token, boardId });

  async function getFrames(frameNames: string[]) {
    const frames = await miroBoard.getBoardObjects(
      { type: "frame" as const },
      { title: frameNames }
    );

    if (frames && frames.length !== frameNames.length) {
      throw Error(
        `${
          frameNames.length - frames.length
        } frame(s) could not be found on the board.`
      );
    }

    return frames;
  }

  async function getSvg(frames?: FrameBoardObject[]) {
    return await miroBoard.getSvg(
      frames?.map(({ id }) => id).filter((id): id is string => !!id)
    );
  }

  async function getJson(frames?: FrameBoardObject[]) {
    if (frames) {
      const frameChildren = await miroBoard.getBoardObjects({
        id: frames.flatMap((frame) => frame.childrenIds)
      });

      const groupChildren = await miroBoard.getBoardObjects({
        id: frameChildren
          .filter((child) => child.type === "group")
          .flatMap((child) => child.itemsIds)
      });

      return JSON.stringify([...frames, ...frameChildren, ...groupChildren]);
    }

    return JSON.stringify(await miroBoard.getBoardObjects({}));
  }

  async function getHash(frameNames: string[]) {
    const result: Record<string, string> = {};
    for (const frameName of frameNames) {
      const frames = await getFrames([frameName]);
      const jsonString = await getJson(frames);
      const hash = createHash("sha256").update(jsonString).digest("hex");
      result[frameName] = hash;
    }
    return { fname2hash: result };
  }

  // decide which SVGs to update
  const frameNames = Object.keys(images);
  const previousCache = getPreviousCache();
  const currentCache = await getHash(frameNames);
  const { addedKeys, modifiedKeys } = getCacheDifferences(
    currentCache,
    previousCache
  );
  const updatedKeys = [...addedKeys, ...modifiedKeys];

  console.log("updatedKeys", updatedKeys);

  // generate and save SVGs
  for (const key of updatedKeys) {
    const svg = await getSvg(await getFrames([key]));
    const fname = images[key];

    writeFileSync(
      path.resolve(path.dirname(inputJson), outDir, fname),
      svg,
      "utf-8"
    );
  }

  // save cache
  const cachePath = path.resolve(path.dirname(inputJson), outDir, "cache.json");
  writeFileSync(cachePath, JSON.stringify(currentCache, null, 2), "utf-8");
})();
