## Working with /goal goals

A `/goal` goal follows the same orchestration approach as everything else. The one difference: a goal allows multiple PRs to be merged during development — always into the goal's feature branch, never into the default branch. Every goal develops on a feature branch: use the one the goal names, or create and name one yourself when it doesn't. As you personally review each PR, feel free to merge it into the feature branch when you consider it ready. The only rule is not to merge broken work. Landing the feature branch on the default branch follows the standing rule: only when the user explicitly asks.

As soon as the goal's feature branch exists, open a draft PR from it to the default branch, and after every merge into the branch rewrite the body so it always describes the branch's present contents to an external reader — current truth, never history. The PR stays draft throughout the goal; marking it ready and merging remain the user's acts.
