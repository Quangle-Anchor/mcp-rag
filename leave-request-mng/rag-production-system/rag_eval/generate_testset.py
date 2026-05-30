"""
rag_eval/generate_testset.py — Auto-generate a QA test set.

Fixes applied:
  - Replaced langchain_openai with langchain_google_genai (stack is Gemini)
  - openai_api_key → google_api_key (Settings has no openai_api_key)
  - Testset generator now uses ChatGoogleGenerativeAI + CustomGeminiEmbeddings

Usage:
    python -m rag_eval.generate_testset --docs-dir ./data/uploads --output testset.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_google_genai import ChatGoogleGenerativeAI
from loguru import logger

from config import get_settings
from core.ingestion.embeddings import get_embeddings

settings = get_settings()


def generate_testset(
    docs_dir: Path,
    output_path: Path,
    test_size: int = 20,
) -> None:
    # Import RAGAS here so the module can still be imported even if ragas not installed
    try:
        from ragas.testset.generator import TestsetGenerator  # type: ignore[import]
        from ragas.testset.evolutions import simple, reasoning, multi_context  # type: ignore[import]
    except ImportError as e:
        logger.error("ragas not installed: {}. Run: pip install ragas", e)
        return

    logger.info("Loading documents from '{}'", docs_dir)
    loader = DirectoryLoader(str(docs_dir), glob="**/*.txt", loader_cls=TextLoader)
    documents = loader.load()

    if not documents:
        logger.warning("No documents found in '{}'", docs_dir)
        return

    # Use Gemini (same stack as production) instead of OpenAI
    generator_llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=settings.google_api_key,
        temperature=0,
    )
    critic_llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=settings.google_api_key,
        temperature=0,
    )
    embeddings = get_embeddings()

    generator = TestsetGenerator.from_langchain(
        generator_llm=generator_llm,
        critic_llm=critic_llm,
        embeddings=embeddings,
    )

    testset = generator.generate_with_langchain_docs(
        documents,
        test_size=test_size,
        distributions={simple: 0.5, reasoning: 0.25, multi_context: 0.25},
    )

    df = testset.to_pandas()
    records = df.to_dict(orient="records")
    output_path.write_text(json.dumps(records, indent=2, ensure_ascii=False))
    logger.info("Testset with {} QA pairs saved to '{}'", len(records), output_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate RAG evaluation testset")
    parser.add_argument("--docs-dir", type=Path, default=Path("data/uploads"))
    parser.add_argument("--output", type=Path, default=Path("rag_eval/testset.json"))
    parser.add_argument("--test-size", type=int, default=20)
    args = parser.parse_args()

    generate_testset(
        docs_dir=args.docs_dir,
        output_path=args.output,
        test_size=args.test_size,
    )
