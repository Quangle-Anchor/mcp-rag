"""Quick test for intent detection and filter generation."""
from core.retrieval.query_optimizer import (
    detect_retrieval_intent, RetrievalIntent,
    generate_tool_filter, generate_biz_filter,
)

# Test intent detection
tests = [
    ("entity LeaveRequest attributes", RetrievalIntent.biz_only),
    ("cu phap create_page", RetrievalIntent.tool_only),
    ("tao microflow ACT_Submit cho LeaveRequest", RetrievalIntent.biz_then_tool),
    ("create a page for leave request", RetrievalIntent.biz_then_tool),
    ("what is the SDK syntax for add_widget", RetrievalIntent.tool_only),
    ("LeaveRequest entity co nhung attribute gi", RetrievalIntent.biz_only),
]
print("=== Intent Detection ===")
for query, expected in tests:
    result = detect_retrieval_intent(query)
    status = "PASS" if result == expected else "FAIL"
    print(f"  [{status}] \"{query[:50]}\" -> {result.value} (expected {expected.value})")

# Test filter generation
print("\n=== Filter Generation ===")
f1 = generate_biz_filter("LeaveRequest approval rules", "behavior")
print(f"  Biz filter (behavior): {f1}")

f2 = generate_tool_filter("create microflow with activities")
print(f"  Tool filter (microflow): {f2}")

f3 = generate_tool_filter("create page with widgets")
print(f"  Tool filter (page): {f3}")

f4 = generate_tool_filter("create entity and associations")
print(f"  Tool filter (entity): {f4}")

print("\nAll tests complete!")
