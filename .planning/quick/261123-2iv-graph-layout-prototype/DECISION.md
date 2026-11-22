# Prototype gate passed

The criteria in PLAN.md were fixed before running ELK. On Node 24.22.3, all eight fixtures passed R1–R4. All 240 seeded runs passed R1–R4 and reproduced the baseline normalized boxes and sequence routes. The legacy comparison uses the same inputs, with the graph's SCC exemptions for the direction metric.

- Tight pool: final sequence routes have zero crossings. Both same-lane main flows stay straight. The ELK-straight ReviewToDecision connects disjoint lane bands after packing, with no free straight passage between the real endpoint boxes.
- Vertical pool: both ELK-straight flows stay straight and the final routes have zero crossings.
- In the first run, four invoice-approval perturbations failed annotation placement. After fixing the process geometry, the prototype now places notes from final anchor bounds and routes the note associations separately. Lane bodies stay available for notes while their headers stay reserved.

Proceed to modules and editor integration. PROTOTYPE.jsonl contains each stage's geometry, final quality metrics, the legacy comparison and the gate verdict.
