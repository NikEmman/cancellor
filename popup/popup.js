let idNumbers = []; // parsed from textarea (not yet queued)
let queuedIds = []; // persistent queue
let currentTabId = null;

const textarea = document.getElementById("csv-input");
const statusEl = document.getElementById("parse-status");
const startBtn = document.getElementById("start");
const addToQueueBtn = document.getElementById("add-to-queue");
const queueCountEl = document.getElementById("queue-count");
const queueListEl = document.getElementById("queue-list");
const clearQueueBtn = document.getElementById("clear-queue-btn");

function updateQueueDisplay() {
  if (queuedIds.length === 0) {
    queueCountEl.textContent = "Ουρά: κενή";
    queueCountEl.style.color = "#9ca3af";
    queueListEl.textContent = "";
    clearQueueBtn.disabled = true;
    startBtn.disabled = true;
  } else {
    queueCountEl.innerHTML = `<span style="color:#16a34a;">Ουρά: ${queuedIds.length} ταυτότητες</span>`;
    queueListEl.textContent = queuedIds.map((x) => x.number).join("  ·  ");
    clearQueueBtn.disabled = false;
    startBtn.disabled = false;
  }
}

async function loadQueue() {
  const stored = await chrome.storage.local.get("queuedIds");
  queuedIds = stored.queuedIds || [];
  updateQueueDisplay();
}

async function saveQueue() {
  await chrome.storage.local.set({ queuedIds });
}

loadQueue();

clearQueueBtn.addEventListener("click", () => {
  queuedIds = [];
  saveQueue();
  updateQueueDisplay();
});

addToQueueBtn.addEventListener("click", () => {
  if (idNumbers.length === 0) return;

  const existingNumbers = new Set(queuedIds.map((x) => x.number));
  const newIds = idNumbers.filter((x) => !existingNumbers.has(x.number));
  const dupes = idNumbers.length - newIds.length;

  queuedIds = [...queuedIds, ...newIds];
  saveQueue();
  updateQueueDisplay();

  textarea.value = "";
  idNumbers = [];

  let msg = `<span class="text-green-600">Προστέθηκαν ${newIds.length} ταυτότητες στην ουρά.</span>`;
  if (dupes > 0)
    msg += ` <span class="text-yellow-600">(${dupes} διπλότυπα παραλείφθηκαν)</span>`;
  statusEl.innerHTML = msg;
  addToQueueBtn.disabled = true;
});

chrome.storage.local.get("partialResults").then((result) => {
  if (result.partialResults && result.partialResults.length > 0) {
    startBtn.disabled = true;
    statusEl.innerHTML = `<span class="text-yellow-600">Βρέθηκαν ${result.partialResults.length} αποθηκευμένα αποτελέσματα. Γίνεται λήψη...</span>`;

    const performDownload = () => {
      downloadCSV(result.partialResults);
      chrome.storage.local.remove("partialResults");
      statusEl.textContent = "";
      updateQueueDisplay();
    };

    setTimeout(performDownload, 2000);
  }
});

const autoParse = () => {
  const text = textarea.value.trim();
  if (!text) {
    statusEl.textContent = "";
    idNumbers = [];
    addToQueueBtn.disabled = true;
    return;
  }
  try {
    idNumbers = parseExcelData(text);
    statusEl.innerHTML = `<span class="text-green-600">${idNumbers.length} ταυτότητες έτοιμες για προσθήκη.</span>`;
    addToQueueBtn.disabled = false;
  } catch (err) {
    statusEl.innerHTML = `<span class="text-red-600">Error: ${err.message}</span>`;
    addToQueueBtn.disabled = true;
    idNumbers = [];
  }
};

textarea.addEventListener("paste", () => setTimeout(autoParse, 50));

let timeout;
textarea.addEventListener("input", () => {
  clearTimeout(timeout);
  timeout = setTimeout(autoParse, 300);
});

function parseExcelData(text) {
  const lines = text
    .trim()
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  if (lines.length === 0) throw new Error("Δεν βρέθηκαν δεδομένα");

  function hasValidIdFormat(id) {
    return /^[A-Za-zΑ-Ω]{1,2}[0-9]{6,8}$/.test(id);
  }

  function isGreekLetters(id) {
    return /^[Α-Ω]{1,2}$/.test(id.replace(/[0-9]/g, ""));
  }

  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const number = lines[i];

    if (!hasValidIdFormat(number)) {
      throw new Error(
        `Γραμμή ${i + 1}: Λάθος μορφή ΑΔΤ "${number}" (1-2 γράμματα + 6-8 ψηφία, π.χ. Α03333605)`,
      );
    }

    if (!isGreekLetters(number)) {
      throw new Error(
        `Γραμμή ${i + 1}: Τα γράμματα πρέπει να είναι ελληνικά "${number}"`,
      );
    }

    result.push({ number });
  }

  if (result.length === 0) throw new Error("Λάθος στη μορφή δεδομένων");

  return result;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  return tab;
}

async function execute(fn, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    func: fn,
    args: args,
  });
}

// Step 1: Search for new ID
async function searchById(idObj) {
  await execute(
    function (id) {
      const input = document.querySelector('input[name$="adt_qs"]');
      const buttons = document.querySelectorAll("button");
      const searchBtn = Array.from(buttons).find(
        (btn) => btn.textContent.trim() === "Αναζήτηση",
      );

      if (!input || !searchBtn) {
        throw new Error("Search input or button not found");
      }

      input.value = id;
      searchBtn.click();
    },
    [idObj.number],
  );

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 2: Extract person data from ID detail page
async function extractPersonData() {
  const [result] = await execute(function () {
    return new Promise((resolve, reject) => {
      const pollInterval = 200;
      const maxAttempts = 50;
      let attempts = 0;

      const check = () => {
        const container = document.querySelector(".xdq");
        if (!container) {
          if (attempts >= maxAttempts)
            reject(new Error("No .xdq container found"));
          else {
            attempts++;
            setTimeout(check, pollInterval);
          }
          return;
        }

        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        let hasRealText = false;
        let node;
        while ((node = walker.nextNode()) && !hasRealText) {
          const text = node.textContent.replace(/\s+/g, " ").trim();
          if (text && text !== "▼" && !text.startsWith("Σφάλμα")) {
            hasRealText = true;
          }
        }

        if (!hasRealText) {
          if (attempts >= maxAttempts) {
            reject(new Error("Container found but no valid text loaded"));
          } else {
            attempts++;
            setTimeout(check, pollInterval);
          }
          return;
        }

        const texts = [];
        const fullWalker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        let fullNode;
        while ((fullNode = fullWalker.nextNode())) {
          const text = fullNode.textContent.replace(/\s+/g, " ").trim();
          if (
            text &&
            text !== "▼" &&
            !/^\d{1,3}$/.test(text) &&
            !text.startsWith("Σφάλμα")
          ) {
            texts.push(text);
          }
        }

        const obj = {};
        for (let i = 0; i < texts.length; i++) {
          const key = texts[i];
          const value = texts[(i + 1) % texts.length];
          if (key && value && obj[key] == null) {
            obj[key] = value;
          }
        }

        const getValue = (k) => obj[k] || "";
        const fields = {
          surname: getValue("Επώνυμο"),
          firstName: getValue("Όνομα"),
          fatherName: getValue("Όνομα Πατρός"),
          motherName: getValue("Όνομα Μητρός"),
          birthDate: getValue("Ημ/νία Γέννησης"),
          birthPlace: getValue("Τόπος Γέννησης").split(" ")[0],
        };

        const adtAntLabel = Array.from(document.querySelectorAll("label")).find(
          (l) => l.textContent.trim() === "Α.Δ.Τ. Αντικατάστασης",
        );
        const oldId =
          adtAntLabel?.closest("tr")?.cells?.[1]?.textContent.trim() ?? "";

        if (!fields.surname && !fields.firstName) {
          reject(new Error("Name fields empty – possible parsing issue"));
        } else if (!oldId) {
          reject(
            new Error("Α.Δ.Τ. Αντικατάστασης κενό – δεν βρέθηκε παλαιό δελτίο"),
          );
        } else {
          resolve({
            success: true,
            surname: fields.surname.trim(),
            firstName: fields.firstName.trim(),
            fatherName: fields.fatherName.trim(),
            motherName: fields.motherName.trim(),
            birthDate: fields.birthDate.trim(),
            birthPlace: fields.birthPlace.trim(),
            oldId,
          });
        }
      };

      check();
    });
  });

  if (!result.result || !result.result.success) {
    throw new Error(result.result?.error || "Failed to extract person data");
  }

  return result.result;
}

// Step 3: Click "Προβολή Στοιχείων Αίτησης"
async function clickApplicationDetailsLink() {
  await execute(function () {
    const links = document.querySelectorAll("a");
    const target = Array.from(links).find(
      (l) => l.textContent.trim() === "Προβολή Στοιχείων Αίτησης",
    );
    if (!target) {
      throw new Error("Link 'Προβολή Στοιχείων Αίτησης' not found");
    }
    target.click();
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 4: Extract application date from synopsis page ("Ημερομηνία Κλήσης")
async function extractApplicationDate() {
  const [result] = await execute(function () {
    return new Promise((resolve, reject) => {
      const pollInterval = 200;
      const maxAttempts = 50;
      let attempts = 0;

      const check = () => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let prevText = "";
        let node;

        while ((node = walker.nextNode())) {
          const raw = node.textContent;
          const text = raw.replace(/[\s ]+/g, " ").trim();
          if (!text) continue;

          if (prevText === "Ημερομηνία Κλήσης") {
            const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
              resolve({
                success: true,
                date: `${match[3]}/${match[2]}/${match[1]}`,
              });
              return;
            }
          }

          if (text.length < 80) prevText = text;
        }

        if (attempts >= maxAttempts) {
          resolve({ success: true, date: "" });
        } else {
          attempts++;
          setTimeout(check, pollInterval);
        }
      };

      check();
    });
  });

  return result.result?.date ?? "";
}

// Step 7: Click "Καταχώριση Μεταβολής" on old ID's page
async function clickChangeLink() {
  await execute(function () {
    const links = document.querySelectorAll("a.xi");
    const target = Array.from(links).find(
      (l) => l.textContent.trim() === "Καταχώριση Μεταβολής",
    );
    if (!target) throw new Error("Link 'Καταχώριση Μεταβολής' not found");
    target.click();
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 8: Select "Ακύρωση" radio button
async function selectCancelRadio() {
  await execute(function () {
    const radio = document.getElementById("type:0");
    if (!radio) throw new Error("Radio button Ακύρωση (type:0) not found");
    radio.click();
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 9: Select "ΑΝΤΙΚΑΤΑΣΤΑΣΗ ΠΑΛΑΙΟΥ ΤΥΠΟΥ" (value=90) from identityFlag
async function selectIdentityFlag90() {
  await execute(function () {
    const select = document.getElementById("identityFlag");
    if (!select) throw new Error("Select identityFlag not found");
    select.value = "90";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 10: Click save button for old-type replacement
async function submitOldTypeReplacement() {
  await execute(function () {
    const button = document.getElementById("updateButton");
    if (!button) throw new Error("updateButton not found");

    const expectedText = "Αποθήκευση Μεταβολής ΑΝΤΙΚΑΤΑΣΤΑΣΗ ΠΑΛΑΙΟΥ ΤΥΠΟΥ";
    const actualText = button.textContent.trim().replace(/\s+/g, " ");
    if (actualText !== expectedText) {
      throw new Error(`Button text mismatch: "${actualText}"`);
    }

    button.click();
  });

  await new Promise((r) => setTimeout(r, 3500));
}

// Step 10b: Verify old-type replacement succeeded by checking status text
async function verifyOldTypeReplacementSuccess() {
  const [result] = await execute(function () {
    const spans = document.querySelectorAll("span");
    for (const span of spans) {
      if (
        span.textContent.trim() ===
        "ΜΗ ΕΝΕΡΓΟ ΔΕΛΤΙΟ. ΑΝΤΙΚΑΤΑΣΤΑΣΗ ΠΑΛΑΙΟΥ ΤΥΠΟΥ"
      ) {
        return true;
      }
    }
    return false;
  });
  return result.result === true;
}

// Step 11: Return to ID detail view
async function clickReturnButton() {
  await execute(function () {
    const button = document.getElementById("finishEditButton");
    if (!button) throw new Error("Επιστροφή στην προβολή δεν βρέθηκε");
    button.click();
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 12: Click "Καταχώριση Καταστροφής"
async function clickDestroyLink() {
  await execute(function () {
    const links = document.querySelectorAll("a.xi");
    const target = Array.from(links).find(
      (l) => l.textContent.trim() === "Καταχώριση Καταστροφής",
    );
    if (!target) throw new Error("Link 'Καταχώριση Καταστροφής' not found");
    target.click();
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Step 13: Click "Αποθήκευση" on destruction page
async function clickStoreButton() {
  await execute(function () {
    const button = document.getElementById("updateButton");
    if (!button) throw new Error("Αποθήκευση button not found");
    button.click();
  });

  await new Promise((r) => setTimeout(r, 2800));
}

// Main workflow
document.getElementById("start").addEventListener("click", async () => {
  try {
    if (queuedIds.length === 0) return;
    chrome.storage.local.remove("partialResults");
    await getCurrentTab();

    const runIds = [...queuedIds];
    const results = [];

    for (const [index, id] of runIds.entries()) {
      statusEl.innerHTML = `<span class="text-yellow-600">Processing ${index + 1}/${runIds.length}: ${id.number}</span>`;

      try {
        // Steps 1–2: search and extract person data from new ID's detail page
        await searchById(id);
        const personData = await extractPersonData();

        if (!personData.success) throw new Error(personData.error);

        // Step 3: navigate to application synopsis
        await clickApplicationDetailsLink();

        // Step 4: extract application date
        const appDate = await extractApplicationDate();

        // Step 5: search for the old ID directly (already extracted from details page)
        await searchById({ number: personData.oldId });

        // Steps 6–12: register change on old ID and destroy it
        await clickChangeLink();
        await selectCancelRadio();
        await selectIdentityFlag90();
        await submitOldTypeReplacement();
        const cancelSucceeded = await verifyOldTypeReplacementSuccess();
        await clickReturnButton();
        await clickDestroyLink();
        await clickStoreButton();

        const completedResult = {
          id: id.number,
          success: true,
          surname: personData.surname,
          firstName: personData.firstName,
          appDate: appDate,
          cancelFailedOldId: cancelSucceeded ? null : personData.oldId,
        };
        results.push(completedResult);

        const saved = await chrome.storage.local.get("partialResults");
        const partialResults = saved.partialResults || [];
        partialResults.push(completedResult);
        chrome.storage.local.set({ partialResults: partialResults });
      } catch (err) {
        results.push({
          id: id.number,
          success: false,
          error: err.message,
        });
        console.error(`Failed: ${id.number} →`, err.message);
      }

      if (index < runIds.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    chrome.storage.local.remove("partialResults");
    queuedIds = [];
    saveQueue();
    updateQueueDisplay();
    downloadCSV(results);
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const summary =
      failed.length > 0
        ? `Completed! ${successful.length}/${results.length} successful.\nFailed (${failed.length}): ${failed.map((f) => f.id).join(", ")}`
        : `Completed! ${successful.length}/${results.length} successful.`;
    alert(summary);
  } catch (err) {
    console.error("Fatal error:", err);
    alert("Error: " + err.message);
  }
});

function downloadCSV(results) {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const esc = (v) => `<td>${String(v ?? "").replace(/</g, "&lt;")}</td>`;

  const successRows = successful
    .map(
      (r) =>
        `<tr>${esc(r.id)}${esc(r.surname)}${esc(r.firstName)}${esc(r.appDate)}${esc(r.cancelFailedOldId ?? "")}</tr>`,
    )
    .join("");

  let failedSection = "";
  if (failed.length > 0) {
    const failedRows = failed
      .map((r) => `<tr>${esc(r.id)}${esc(r.error)}</tr>`)
      .join("");
    failedSection = `
      <tr><td></td></tr>
      <tr><td colspan="4"><b>ΑΠΟΤΥΧΙΕΣ</b></td></tr>
      <tr><th>ΑΔΤ</th><th>Σφάλμα</th></tr>
      ${failedRows}`;
  }

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"></head>
    <body>
      <table>
        <tr><th>ΑΔΤ</th><th>Επώνυμο</th><th>Όνομα</th><th>Ημ/νία Αίτησης</th><th>Αποτυχία Ακύρωσης</th></tr>
        ${successRows}
        ${failedSection}
      </table>
    </body>
    </html>`;

  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "ΣΤΟΙΧΕΙΑ.xls";
  a.click();
  URL.revokeObjectURL(url);
}
