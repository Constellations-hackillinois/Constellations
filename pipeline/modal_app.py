"""Modal app for GLM-5 (FP8) PDF-to-markdown pipeline on 8x H100."""

import modal

app = modal.App("constellations-pipeline")

model_volume = modal.Volume.from_name("glm5-model-cache", create_if_missing=True)
MODEL_DIR = "/model"
MODEL_ID = "zai-org/GLM-5-FP8"

vllm_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "vllm>=0.8.0",
    "PyMuPDF>=1.25.0",
    "huggingface_hub>=0.27.0",
    "hf_transfer>=0.1.9",
)

CONVERT_PROMPT = """You are given raw text extracted from an academic PDF. Convert it into clean, well-structured markdown. Follow these rules:

1. Use proper markdown headers (# for title, ## for sections, ### for subsections)
2. Preserve all technical content: equations, formulas, data, metrics, method names
3. Format tables as markdown tables
4. Skip these sections entirely: References, Bibliography, Acknowledgements, Table of Contents
5. Skip page headers, footers, and page numbers
6. Keep figure/table captions but note them as [Figure X] or [Table X]

Return ONLY the markdown content, no explanations."""


@app.function(
    volumes={MODEL_DIR: model_volume},
    image=vllm_image,
    timeout=86400,
    ephemeral_disk=2000 * 1024,  # 2 TB scratch disk
    memory=16384,
)
def download_model():
    """Download GLM-5-FP8 weights to Modal Volume (run once)."""
    import os
    import time
    from huggingface_hub import snapshot_download

    # Use hf_transfer for fast, parallel chunk downloads
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"

    start = time.time()
    snapshot_download(
        MODEL_ID,
        local_dir=MODEL_DIR,
        max_workers=4,
    )
    elapsed = time.time() - start
    print(f"Download complete in {elapsed / 60:.1f} minutes")
    model_volume.commit()


@app.function(image=vllm_image)
def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract text from PDF using PyMuPDF and apply cleaning."""
    import re
    from collections import Counter

    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [page.get_text("text") for page in doc]
    doc.close()
    text = "\n\n".join(pages)

    # --- Inline text cleaning (mirrors utils/text_cleaning.py) ---

    # Strip repeated headers/footers
    lines = text.split("\n")
    if len(lines) >= 20:
        stripped = [line.strip() for line in lines]
        counts = Counter(stripped)
        repeated = {
            line for line, count in counts.items() if count >= 3 and 0 < len(line) < 80
        }
        lines = [l for l, s in zip(lines, stripped) if s not in repeated]
        text = "\n".join(lines)

    # Strip table of contents
    toc = re.search(r"\n\s*(?:Table\s+of\s+)?Contents?\s*\n", text[:3000], re.IGNORECASE)
    if toc:
        ns = re.search(r"\n\s*(?:1\.?\s+|Abstract|Introduction)", text[toc.end() :], re.IGNORECASE)
        if ns:
            text = text[: toc.start()] + text[toc.end() + ns.start() :]

    # Strip acknowledgements
    ack = re.search(r"\n\s*Acknowledg(?:e)?ments?\s*\n", text, re.IGNORECASE)
    if ack:
        ns = re.search(r"\n\s*(?:\d+\.?\s+)?[A-Z][a-z]", text[ack.end() :])
        if ns:
            text = text[: ack.start()] + text[ack.end() + ns.start() :]
        else:
            text = text[: ack.start()].rstrip()

    # Strip references
    ref = re.search(r"\n\s*(?:References|Bibliography|Works\s+Cited)\s*\n", text, re.IGNORECASE)
    if ref:
        text = text[: ref.start()].rstrip()

    # Collapse excessive whitespace
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


@app.function(
    gpu="H100:8",
    volumes={MODEL_DIR: model_volume},
    image=vllm_image,
    timeout=600,
)
def structure_markdown(raw_text: str) -> str:
    """Use GLM-5 via vLLM to convert raw text into structured markdown."""
    from vllm import LLM, SamplingParams

    llm = LLM(
        MODEL_DIR,
        tensor_parallel_size=8,
        gpu_memory_utilization=0.85,
    )

    messages = [
        {"role": "system", "content": CONVERT_PROMPT},
        {"role": "user", "content": raw_text},
    ]

    sampling_params = SamplingParams(temperature=0.1, max_tokens=8192)
    outputs = llm.chat(messages=[messages], sampling_params=sampling_params)
    return outputs[0].outputs[0].text.strip()


@app.local_entrypoint()
def main():
    """Test entrypoint: pass a PDF file path to convert."""
    import sys

    if len(sys.argv) < 2:
        print("Usage: modal run pipeline/modal_app.py -- <pdf_path>")
        return

    pdf_path = sys.argv[1]
    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()

    print(f"Extracting text from {pdf_path}...")
    raw_text = extract_pdf_text.remote(pdf_bytes)
    print(f"Extracted {len(raw_text)} chars, structuring with GLM-5...")
    markdown = structure_markdown.remote(raw_text)
    print(f"Done! {len(markdown)} chars of markdown")
    print(markdown[:2000])
