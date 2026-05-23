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

export function mountReviseComposer(host: HTMLElement, props: ReviseComposerProps): void {
  host.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "revise-composer";
  wrap.setAttribute("role", "form");
  wrap.setAttribute("aria-label", TITLE_BY_SCOPE[props.scope]);

  const title = document.createElement("div");
  title.className = "revise-composer__title";
  title.textContent = TITLE_BY_SCOPE[props.scope];
  wrap.appendChild(title);

  const ta = document.createElement("textarea");
  ta.className = "revise-composer__instruction";
  ta.placeholder = "e.g. tighten verbs, add a metric, focus on AI work";
  ta.rows = 3;
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

  actions.appendChild(cancel);
  actions.appendChild(submit);
  wrap.appendChild(actions);
  host.appendChild(wrap);

  const trySubmit = (): void => {
    const v = ta.value.trim();
    if (v.length === 0) return;
    props.onSubmit(v);
  };

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

  setTimeout(() => ta.focus(), 0);
}
