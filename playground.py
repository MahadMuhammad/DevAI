def findageGroupMovies(age):
    if age < 13:
        return "Kids"
    elif age >= 13 and age < 18:
        return "Teenagers"
    else:
        return "Adults"

# Test cases
test_cases = [
    {"input": 5, "expected_output": "Kids"},
    {"input": 12, "expected_output": "Teenagers"},
    {"input": 17, "expected_output": "Adults"},  # Corrected from "Teenagers"
    {"input": 19, "expected_output": "Adults"}
]

# Run the test cases
for case in test_cases:
    output = findageGroupMovies(case["input"])
    assert output == case["expected_output"], f"Test failed for input {case['input']}. Expected: {case['expected_output']}, but got: {output}"
    print(f"Test passed for input {case['input']}")

# Additional test cases to cover edge cases
additional_test_cases = [
    {"input": 13, "expected_output": "Teenagers"},
    {"input": 18, "expected_output": "Adults"}
]

for case in additional_test_cases:
    output = findageGroupMovies(case["input"])
    assert output == case["expected_output"], f"Test failed for input {case['input']}. Expected: {case['expected_output']}, but got: {output}"
    print(f"Test passed for input {case['input']}")