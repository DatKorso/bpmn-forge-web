// Chosen from the BPMN model before evaluating placement changes.
export const straightFlows = {
  'acyclic-reorder': ['BA'],
  'compact-x': ['Ready'],
  'compact-y': ['Ready'],
  'invoice-approval': ['Reviewed', 'Pay'],
  'tight-pool': ['StartToReview', 'DecisionToEnd'],
  'split-merge': ['Main']
};

export const straightExceptions = {
  'acyclic-reorder': { SA: 'The default skips intermediate node B in the forward order S, B, A.' },
  'invoice-approval': { Approved: 'The default crosses from the review lane into the accounting lane.' }
};
