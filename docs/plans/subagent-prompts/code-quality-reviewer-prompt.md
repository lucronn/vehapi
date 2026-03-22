# Code Quality Reviewer Prompt Template

Use **only after** spec compliance review passes (✅).

**Purpose:** Implementation quality (clean, tested, maintainable).

````
Task tool (superpowers:code-reviewer):
  Use template at requesting-code-review/code-reviewer.md

  WHAT_WAS_IMPLEMENTED: [from implementer's report]
  PLAN_OR_REQUIREMENTS: Task N from [plan-file]
  BASE_SHA: [commit before task]
  HEAD_SHA: [current commit]
  DESCRIPTION: [task summary]
````

**In addition to standard code quality concerns, the reviewer should check:**
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment

---

If you don’t use the code-reviewer skill, paste this shorter prompt instead:

```
You are doing a code quality review (not spec — spec already passed).

## Change summary
[implementer report + file list]

## Requirements
Read the diff or files and report:
- Strengths
- Issues: Critical / Important / Minor (with file:line)
- Suggestions for follow-up (optional)

Focus on: correctness risks, tests, naming, edge cases, security/sensitive data, and fit with existing Torque patterns (Angular standalone, vehapiproxi CommonJS, etc.).
```
