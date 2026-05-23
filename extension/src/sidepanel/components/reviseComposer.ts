export interface ReviseComposerProps {
  scope: "bullet" | "section" | "whole-resume";
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
}

const TITLE_BY_SCOPE: Record<ReviseComposerProps["scope"], string> = {
  bullet: "Revise this bullet",
  section: "Revise this section",
  "whole-resume": "Revise whole resume",
};

export function renderReviseComposer(props: ReviseComposerProps): HTMLElement {
  const title = TITLE_BY_SCOPE[props.scope];

  const wrap = document.createElement("div");
  wrap.className = "revise-composer";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", title);

  const titleEl = document.createElement("div");
  titleEl.className = "revise-composer__title";
  titleEl.textContent = title;
  wrap.appendChild(titleEl);

  const ta = document.createElement("textarea");
  ta.className = "revise-composer__instruction";
  ta.placeholder = "e.g. tighten verbs, add a metric, focus on AI work";
  ta.rows = 3;
  ta.setAttribute("aria-label", title);
  wrap.appendChild(ta);

  const actions = document.createElement("div");
  actions.className = "revise-composer__actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-secondary";
  cancel.setAttribute("data-action", "cancel");
  cancel.textContent = "Cancel";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn btn-primary";
  submit.setAttribute("data-action", "submit");
  submit.textContent = "Submit";
  submit.disabled = true;

  actions.appendChild(cancel);
  actions.appendChild(submit);
  wrap.appendChild(actions);

  const trySubmit = (): void => {
    const v = ta.value.trim();
    if (v.length === 0) return;
    props.onSubmit(v);
  };

  ta.addEventListener("input", () => {
    submit.disabled = ta.value.trim().length === 0;
  });
  submit.addEventListener("click", trySubmit);
  cancel.addEventListener("click", () => props.onCancel());
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      trySubmit();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      props.onCancel();
    }
  });

  queueMicrotask(() => ta.focus());

  return wrap;
}
