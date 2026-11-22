# Harden and refactor BPMN auto-alignment

1. Capture geometry and routing goldens, deterministic invariants and a timing baseline before production changes.
2. Verify the bpmn-js integration, split the planner into named stages and modules, then profile and optimize against the baseline. Use the measured one-second threshold for worker adoption.
3. Cover additional BPMN constructs and editor workflows, implement the proposed controls, and record outstanding user-supplied fixtures.
