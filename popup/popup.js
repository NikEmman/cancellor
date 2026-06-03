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

const otherDeptCheck = document.getElementById("other-dept-check");
const otherDeptFields = document.getElementById("other-dept-fields");
const a130Check = document.getElementById("a130-check");
const a130Fields = document.getElementById("a130-fields");
const a130AmyInput = document.getElementById("a130-amy");
const a130AmyWarn = document.getElementById("a130-amy-warn");
const a130BathmosInput = document.getElementById("a130-bathmos");
const a130DeptsInput = document.getElementById("a130-depts");

const parseDepts = (raw) =>
  raw.split("\n").map((l) => l.trim()).filter(Boolean);

let a130Depts = parseDepts(localStorage.getItem("a130-depts") ?? a130DeptsInput.value);

// Restore persisted state
(function restoreState() {
  const otherDeptStored = localStorage.getItem("other-dept-check");
  if (otherDeptStored !== null) {
    otherDeptCheck.checked = otherDeptStored === "true";
    otherDeptFields.classList.toggle("visible", otherDeptCheck.checked);
  }

  const a130Stored = localStorage.getItem("a130-check");
  if (a130Stored !== null) {
    a130Check.checked = a130Stored === "true";
    a130Fields.classList.toggle("visible", a130Check.checked);
  }

  const amyStored = localStorage.getItem("a130-amy");
  if (amyStored !== null) {
    a130AmyInput.value = amyStored;
    if (amyStored) a130AmyWarn.style.display = /^\d{4}$/.test(amyStored) ? "none" : "block";
  }

  const bathmosStored = localStorage.getItem("a130-bathmos");
  if (bathmosStored !== null) a130BathmosInput.value = bathmosStored;

  const deptsStored = localStorage.getItem("a130-depts");
  if (deptsStored !== null) a130DeptsInput.value = deptsStored;
})();

otherDeptCheck.addEventListener("change", () => {
  otherDeptFields.classList.toggle("visible", otherDeptCheck.checked);
  localStorage.setItem("other-dept-check", otherDeptCheck.checked);
});

a130Check.addEventListener("change", () => {
  a130Fields.classList.toggle("visible", a130Check.checked);
  localStorage.setItem("a130-check", a130Check.checked);
});

a130AmyInput.addEventListener("input", () => {
  const val = a130AmyInput.value;
  a130AmyWarn.style.display = val && !/^\d{4}$/.test(val) ? "block" : "none";
  localStorage.setItem("a130-amy", val);
});

a130BathmosInput.addEventListener("blur", () => {
  a130BathmosInput.value = a130BathmosInput.value.trim();
  localStorage.setItem("a130-bathmos", a130BathmosInput.value);
});

a130DeptsInput.addEventListener("input", () => {
  a130Depts = parseDepts(a130DeptsInput.value);
  localStorage.setItem("a130-depts", a130DeptsInput.value);
});

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

// Pre-step: Extract the logged-in operator's details from the sidebar profile panel
async function extractOperatorData() {
  const [result] = await execute(function () {
    const profileCell = document.querySelector(
      'form#userForm td.x4w[colspan="1"]',
    );
    if (!profileCell)
      return { success: false, error: "User profile panel not found" };

    const cells = profileCell.querySelectorAll("td.x51");
    if (cells.length < 3)
      return { success: false, error: "Not enough profile cells" };

    const employeeName =
      cells[0].querySelector("label[title]")?.title?.trim() ?? "";
    const badgeNumber = cells[1].textContent.replace(/\s+/g, " ").trim();
    const deptLabels = cells[2].querySelectorAll("label[title]");
    const department = deptLabels[0]?.title?.trim() ?? "";
    const overseeingDept = deptLabels[1]?.title?.trim() ?? "";

    return {
      success: true,
      employeeName,
      badgeNumber,
      department,
      overseeingDept,
    };
  });

  if (!result.result?.success) {
    throw new Error(result.result?.error || "Failed to extract operator data");
  }
  return result.result;
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

// Step 6b: Extract data from old ID's detail page
async function extractOldIdData() {
  const [result] = await execute(function () {
    return new Promise((resolve, reject) => {
      const pollInterval = 200;
      const maxAttempts = 50;
      let attempts = 0;

      const check = () => {
        const anchor = document.querySelector(
          "form#searchForm tr.p_AFReadOnly td.x51 div.x25",
        );
        if (!anchor || !anchor.textContent.trim()) {
          if (attempts >= maxAttempts)
            reject(new Error("Old ID detail page did not load"));
          else {
            attempts++;
            setTimeout(check, pollInterval);
          }
          return;
        }

        // Build label→value map by walking each read-only row
        const map = {};
        const rows = document.querySelectorAll(
          "form#searchForm tr.p_AFReadOnly",
        );
        for (const row of rows) {
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          const texts = [];
          let node;
          while ((node = walker.nextNode())) {
            const t = node.textContent.replace(/\s+/g, " ").trim();
            if (t && t !== " ") texts.push(t);
          }
          // First text is the label, second is the value
          if (texts.length >= 2 && map[texts[0]] == null) {
            map[texts[0]] = texts[1];
          }
        }

        const idNumber = document.getElementById("adt")?.value?.trim() ?? "";
        const birthDate =
          document.getElementById("birthdate")?.textContent?.trim() ?? "";
        const issuingAuth =
          document.getElementById("t901arxekd_readonly")?.textContent?.trim() ??
          "";

        resolve({
          success: true,
          idNumber,
          surname: map["Επώνυμο"] ?? "",
          firstName: map["Όνομα"] ?? "",
          fatherName: map["Όνομα Πατρός"] ?? "",
          motherName: map["Όνομα Μητρός"] ?? "",
          birthDate,
          issuingAuth,
        });
      };

      check();
    });
  });

  if (!result.result?.success) {
    throw new Error(result.result?.error || "Failed to extract old ID data");
  }
  return result.result;
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

function isIssuingAuthUsersDept(issuingAuth) {
  if (!otherDeptCheck.checked) return true;
  const deptName = issuingAuth.replace(/^\d+\s*-\s*/, "").trim();
  const normalize = (s) => s.replace(/\s+/g, " ").trim().toUpperCase();
  const normalized = normalize(deptName);
  return a130Depts.some((d) => normalize(d) === normalized);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

async function processDocx(arrayBuffer, replacements) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("word/document.xml not found in template");
  let xml = await xmlFile.async("string");
  for (const [key, val] of Object.entries(replacements)) {
    xml = xml.replace(new RegExp(`\\{${key}\\}`, "g"), val ?? "");
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "arraybuffer" });
}

async function generateA130(oldIdData, personData, operatorData, appDate) {
  const A130_BASE64 =
    "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"; // TODO: paste base64-encoded .docx template here

  if (!A130_BASE64) {
    console.warn("generateA130: no template set, skipping download");
    return;
  }

  const today = new Date();
  const formattedDate = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

  const replacements = {
    idNumber:         oldIdData.idNumber,
    surname:          oldIdData.surname,
    firstName:        oldIdData.firstName,
    fatherName:       oldIdData.fatherName,
    motherName:       oldIdData.motherName,
    birthDate:        oldIdData.birthDate,
    issuingAuthority: oldIdData.issuingAuth,
    newId:            personData.oldId,
    anakritikosName:  operatorData.employeeName,
    ypiresia:         operatorData.department,
    dAstynomias:      operatorData.overseeingDept,
    amy:              a130AmyInput.value.trim(),
    rank:             a130BathmosInput.value.trim(),
    formattedDate,
  };

  const arrayBuffer = base64ToArrayBuffer(A130_BASE64);
  const docx = await processDocx(arrayBuffer, replacements);
  const blob = new Blob([docx], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `A130-${oldIdData.surname}-${oldIdData.issuingAuth}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// Main workflow
document.getElementById("start").addEventListener("click", async () => {
  try {
    if (queuedIds.length === 0) return;
    chrome.storage.local.remove("partialResults");
    await getCurrentTab();

    const operatorData = await extractOperatorData();
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

        // Step 6b: extract old ID's detail data before navigating away
        const oldIdData = await extractOldIdData();

        // Steps 7–11: register type-replacement change on old ID
        await clickChangeLink();
        await selectCancelRadio();
        await selectIdentityFlag90();
        await submitOldTypeReplacement();
        const cancelSucceeded = await verifyOldTypeReplacementSuccess();
        await clickReturnButton();

        let a130Generated = false;
        if (isIssuingAuthUsersDept(oldIdData.issuingAuth)) {
          // Happy path: our department issued the old ID — destroy it
          await clickDestroyLink();
          await clickStoreButton();
        } else {
          // Other department: generate Α130 if requested
          if (a130Check.checked) {
            await generateA130(oldIdData, personData, operatorData, appDate);
            a130Generated = true;
          }
        }

        const completedResult = {
          id: id.number,
          success: true,
          surname: personData.surname,
          firstName: personData.firstName,
          appDate: appDate,
          cancelFailedOldId: cancelSucceeded ? null : personData.oldId,
          a130Generated,
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
    downloadCSV(results, a130Check.checked);
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

function downloadCSV(results, showA130 = false) {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const esc = (v) => `<td>${String(v ?? "").replace(/</g, "&lt;")}</td>`;

  const successRows = successful
    .map(
      (r) =>
        `<tr>${esc(r.id)}${esc(r.surname)}${esc(r.firstName)}${esc(r.appDate)}${esc(r.cancelFailedOldId ?? "")}${showA130 ? esc(r.a130Generated ? "Ναι" : "") : ""}</tr>`,
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

  const a130Header = showA130 ? "<th>A130</th>" : "";

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"></head>
    <body>
      <table>
        <tr><th>ΑΔΤ</th><th>Επώνυμο</th><th>Όνομα</th><th>Ημ/νία Αίτησης</th><th>Αποτυχία Ακύρωσης</th>${a130Header}</tr>
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
