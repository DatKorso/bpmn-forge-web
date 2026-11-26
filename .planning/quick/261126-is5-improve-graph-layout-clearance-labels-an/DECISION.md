# Accepted graph route changes

The quality check applies the 8 px SequenceFlow clearance rule to original and perturbed graph workloads. It preserves the original baseline for the legacy engine.

- Both shortcuts in two-shortcuts retain their 16 px bypass. The unobstructed continuations and required default paths in R5 stay direct.
- In invoice-approval, the timer bypass stays outside its host after its local exit and separates from the handoff and approval paths. The wider bypass increases the total SequenceFlow length from 1279 to 2023 px and the bend count from 5 to 8. The pool area, straight continuations, crossings and shared segments meet the existing gates.
- In incident-escalation, the timer and closure paths stay separate and the total SequenceFlow length decreases from 852 to 820 px. The self-loop fixture has separate routes at both ports and loses its 16 px of shared path.
- The other fingerprint changes cover the full clearance on sequence paths and Association paths recalculated after notes keep their anchor offset. R1–R6 and the crossing and shared-segment checks pass across 22 diagrams.
