"""
rag_eval/run_eval.py — Execute RAGAS evaluation metrics against the live pipeline.

Fixes applied:
  - Replaced OpenAI with Gemini (google_api_key, ChatGoogleGenerativeAI)
  - retrieve_chunks now returns (chunks, guardrail_msg) tuple — unpacked correctly
  - Removed broken r.payload["content"] subscript (Pinecone-specific)
  - Guarded all ragas/pandas imports to avoid import errors when not installed

Usage:
    python -m rag_eval.run_eval --testset rag_eval/testset.json --output rag_eval/results.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI
from loguru import logger

from config import get_settings
from core.ingestion.embeddings import get_embeddings
from core.retrieval.query_optimizer import QueryContext
from core.retrieval.retriever import retrieve_chunks
from core.generation.chain import generate_answer

settings = get_settings()


async def _run_pipeline_on_testset(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run the live RAG pipeline on each test question and collect results."""
    results: list[dict[str, Any]] = []
    for i, record in enumerate(records):
        question: str = record["question"]
        ground_truth: str = record.get("ground_truth", "")

        logger.info("[{}/{}] Evaluating: '{}'", i + 1, len(records), question[:60])

        # retrieve_chunks returns (chunks, guardrail_msg) tuple
        # Create a fresh QueryContext per question (tracks call count)
        ctx = QueryContext(original_query=question)
        chunks, guardrail_msg = await retrieve_chunks(query=question, ctx=ctx)

        if guardrail_msg:
            logger.warning("[EVAL] Guardrail triggered for question: {}", question[:60])
            contexts: list[str] = []
            answer_text = guardrail_msg
        else:
            contexts = [c["content"] for c in chunks]
            answer_text = await generate_answer(
                query=question,
                context_chunks=contexts,
                history=[],
            )

        results.append(
            {
                "question": question,
                "answer": answer_text,
                "contexts": contexts,
                "ground_truth": ground_truth,
            }
        )
    return results


def run_evaluation(testset_path: Path, output_path: Path) -> None:
    # Guard optional heavy imports
    try:
        import pandas as pd  # type: ignore[import]
        from datasets import Dataset  # type: ignore[import]
        from ragas import evaluate  # type: ignore[import]
        from ragas.metrics import (  # type: ignore[import]
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )
    except ImportError as e:
        logger.error("Missing dependency for evaluation: {}. Run: pip install ragas datasets pandas", e)
        return

    records: list[dict[str, Any]] = json.loads(testset_path.read_text())
    logger.info("Loaded {} test cases from '{}'", len(records), testset_path)

    pipeline_results = asyncio.run(_run_pipeline_on_testset(records))
    dataset = Dataset.from_list(pipeline_results)

    # Use Gemini (same stack as production)
    llm = ChatGoogleGenerativeAI(
        model=settings.llm_model,
        google_api_key=settings.google_api_key,
        temperature=0,
    )
    embeddings = get_embeddings()

    logger.info("Running RAGAS evaluation metrics...")
    score = evaluate(
        dataset=dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        llm=llm,
        embeddings=embeddings,
    )

    df: pd.DataFrame = score.to_pandas()
    summary: dict[str, float] = df.mean(numeric_only=True).to_dict()

    output = {
        "summary": {k: round(v, 4) for k, v in summary.items()},
        "per_question": df.to_dict(orient="records"),
    }
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    logger.info("Evaluation complete. Results saved to '{}'", output_path)
    logger.info("Summary: {}", summary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run RAGAS evaluation")
    parser.add_argument("--testset", type=Path, default=Path("rag_eval/testset.json"))
    parser.add_argument("--output", type=Path, default=Path("rag_eval/results.json"))
    args = parser.parse_args()

    run_evaluation(testset_path=args.testset, output_path=args.output)
