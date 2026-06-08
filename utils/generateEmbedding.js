import { pipeline } from "@xenova/transformers";

let embedder = null;
async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline(
      "feature-extraction", // Convert text → vector embeddings
      "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    );
  }
  return embedder;
}

export async function generateEmbedding(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });

  const embedding = Array.from(output.data);
  return embedding.map(Number);
}

// Normalizes vector length.
// This makes similarity search more accurate.

//   output.data is usually a:

// Float32Array

// Example:

// Float32Array(5) [
//   0.12,
//   -0.44,
//   0.88,
//   0.33,
//   -0.11
// ]

// Problem

// Many databases/APIs expect:

// normal JavaScript arrays

// NOT typed arrays.

// So you convert it.

// = Array.from(output.data);

// Converts:

// Float32Array

// ↓

// normal array

// ["1", "2", "3"].map(Number)

// becomes:

// [1, 2, 3]
// In Your Case

// It usually converts:

// Float32 values

// into:

// plain JS numbers

// Final Result

// You finally return:

// [
//   0.018,
//   -0.221,
//   0.771,
//   ...
// ]

// Without conversion:

// output.data

// might look like:

// Float32Array(384)

// Some databases/tools may not handle that properly.

// These lines standardize the data into simple JavaScript arrays.
