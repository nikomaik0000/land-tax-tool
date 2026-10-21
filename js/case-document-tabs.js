export function mountCaseDocumentTabs(doc = document) {
  const tabs = [...doc.querySelectorAll("[data-case-tab]")];
  const panels = [...doc.querySelectorAll("[data-case-tab-panel]")];
  if (!tabs.length || !panels.length) return { activate() {} };

  tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.caseTab)));
  tabs.forEach((tab, index) => tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    activate(tabs[nextIndex].dataset.caseTab);
  }));

  activate(tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.caseTab || tabs[0].dataset.caseTab);
  return { activate };

  function activate(name) {
    tabs.forEach((tab) => {
      const selected = tab.dataset.caseTab === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.caseTabPanel !== name; });
  }
}
