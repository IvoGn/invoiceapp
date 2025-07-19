const { ipcRenderer } = require('electron');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const PDFDocument = require('pdfkit');

let filePath = null;
let rechnungsNummerCounter = parseInt(localStorage.getItem('invoiceCounter') || '1', 10);

// Unternehmensdaten & Einstellungen laden
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('companyData');
  if (saved) {
    const data = JSON.parse(saved);
    for (const [key, value] of Object.entries(data)) {
      const input = document.querySelector(`[name="${key}"]`);
      if (input) input.value = value;
    }
  }

  const savedSettings = JSON.parse(localStorage.getItem('invoiceSettings') || '{}');
  if (savedSettings.separator) {
    document.getElementById('separatorSelect').value = savedSettings.separator;
  }
  if (savedSettings.prefix) {
    document.getElementById('invoicePrefix').value = savedSettings.prefix;
  }

  const outputFolder = localStorage.getItem('outputFolderPath');
  if (outputFolder) {
    document.getElementById('outputFolderPath').textContent = `📁 Zielordner: ${outputFolder}`;
  }

  const savedLogo = localStorage.getItem('companyLogo');
  if (savedLogo) {
    const preview = document.getElementById('logoPreview');
    if (preview) preview.src = savedLogo;
  }
});

// Firmenlogo speichern
document.getElementById('logoUpload')?.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    localStorage.setItem('companyLogo', e.target.result);
    const preview = document.getElementById('logoPreview');
    if (preview) preview.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// Unternehmensdaten speichern
document.getElementById('companyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  localStorage.setItem('companyData', JSON.stringify(data));
  document.getElementById('companyStatus').textContent = '✅ Unternehmensdaten gespeichert.';
});

// Zielordner auswählen
document.getElementById('selectOutputFolderBtn').addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('select-output-folder');
  if (!folder) return;
  localStorage.setItem('outputFolderPath', folder);
  document.getElementById('outputFolderPath').textContent = `📁 Zielordner: ${folder}`;
});

// CSV auswählen
document.getElementById('selectCsvBtn').addEventListener('click', async () => {
  const selectedPath = await ipcRenderer.invoke('open-file-dialog');
  if (!selectedPath) return;

  filePath = selectedPath;
  document.getElementById('csvFileName').textContent = `📄 Gewählte Datei: ${path.basename(filePath)}`;
  parseHeader(filePath, (headers) => renderMappingForm(headers));
});

// Header lesen
function parseHeader(file, callback) {
  let parsed = false;
  const separator = document.getElementById('separatorSelect')?.value || ',';

  fs.createReadStream(file)
    .pipe(csv({ separator }))
    .on('headers', (headers) => {
      if (!parsed) {
        parsed = true;
        callback(headers);
      }
    });
}

// Mapping-Formular anzeigen
function renderMappingForm(headers) {
  const fields = [
    { key: 'first_name', label: 'Vorname' },
    { key: 'last_name', label: 'Nachname' },
    { key: 'user_email', label: 'E-Mail' },
    { key: 'street', label: 'Straße' },
    { key: 'zip', label: 'Postleitzahl' },
    { key: 'city', label: 'Stadt' },
    { key: 'country', label: 'Land' },
    { key: 'product_name', label: 'Produkt' },
    { key: 'amount', label: 'Einzelpreis netto' },
    { key: 'tax_amount', label: 'Steuerbetrag' },
    { key: 'total', label: 'Gesamtbetrag' },
    { key: 'created_at', label: 'Rechnungsdatum' }
  ];

  const form = document.getElementById('mappingForm');
  form.innerHTML = '';
  document.getElementById('mappingSection').style.display = 'block';

  const savedMapping = JSON.parse(localStorage.getItem('columnMapping') || '{}');

  fields.forEach(({ key, label }) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <label>${label}:
        <select name="${key}">
          ${headers.map(h => `<option value="${h}" ${savedMapping[key] === h ? 'selected' : ''}>${h}</option>`).join('')}
        </select>
      </label>`;
    form.appendChild(wrapper);
  });

  const buttonWrapper = document.createElement('div');
  buttonWrapper.style.display = 'flex';
  buttonWrapper.style.gap = '10px';
  buttonWrapper.classList.add('mt-3');

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.textContent = 'Vorschau anzeigen';
  previewBtn.classList.add('btn', 'btn-outline-primary');
  previewBtn.style.flex = '1';

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.textContent = 'Rechnungen erzeugen';
  btn.classList.add('btn', 'btn-primary');
  btn.style.flex = '1';

  buttonWrapper.appendChild(previewBtn);
  buttonWrapper.appendChild(btn);
  form.appendChild(buttonWrapper);

  previewBtn.addEventListener('click', async () => {
    if (!filePath) {
      alert('Bitte zuerst eine CSV-Datei auswählen!');
      return;
    }

    const formData = new FormData(form);
    const mapping = Object.fromEntries(formData.entries());
    const separator = document.getElementById('separatorSelect').value || ',';

    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv({ separator }))
      .on('data', (data) => {
        if (rows.length < 1) rows.push(data);
      })
      .on('end', async () => {
        if (rows.length === 0) {
          alert('Die CSV-Datei ist leer!');
          return;
        }

        const mapped = {};
        for (const key in mapping) {
          mapped[key] = rows[0][mapping[key]] || '';
        }

        const companyData = JSON.parse(localStorage.getItem('companyData') || '{}');
        const invoiceSettings = JSON.parse(localStorage.getItem('invoiceSettings') || '{}');
        const prefix = invoiceSettings.prefix || 'RE-';
        const previewInvoiceNumber = `${prefix}-0001`;
        const taxRate = parseFloat(document.getElementById('taxRate')?.value || 19);

        try {
          const products = [{
            name: mapped.product_name,
            price: parseFloat(mapped.amount || 0),
            tax: parseFloat(mapped.tax_amount || 0)
          }];
          const pdfBuffer = await createInvoicePdfBuffer(mapped, companyData, previewInvoiceNumber, taxRate, products);
          await ipcRenderer.invoke('open-preview-window');
          ipcRenderer.send('send-preview-pdf', pdfBuffer);
        } catch (err) {
          alert('Fehler beim Erzeugen der Vorschau: ' + err.message);
          console.error(err);
        }
      });
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    if (!filePath) {
      alert('Bitte zuerst eine CSV-Datei auswählen!');
      return;
    }

    const formData = new FormData(form);
    const mapping = Object.fromEntries(formData.entries());
    localStorage.setItem('columnMapping', JSON.stringify(mapping));

    const settings = {
      separator: document.getElementById('separatorSelect')?.value || ',',
      prefix: document.getElementById('invoicePrefix')?.value || 'RE-'
    };
    localStorage.setItem('invoiceSettings', JSON.stringify(settings));

    readAndGenerateInvoices(mapping, settings);
  };
}

function readAndGenerateInvoices(mapping, settings) {
  const companyData = JSON.parse(localStorage.getItem('companyData') || '{}');
  const separator = settings.separator || ',';
  const prefix = settings.prefix || 'RE-';
  const outputFolder = localStorage.getItem('outputFolderPath') || __dirname;
  const taxRate = parseFloat(document.getElementById('taxRate')?.value || 19);

  const rows = [];
  fs.createReadStream(filePath)
    .pipe(csv({ separator }))
    .on('data', (data) => rows.push(data))
    .on('end', () => {
      if (rows.length === 0) {
        const statusBox = document.getElementById('status');
        statusBox.classList.remove('d-none', 'alert-success');
        statusBox.classList.add('alert-danger');
        statusBox.textContent = '❌ Die CSV-Datei ist leer.';
        return;
      }

      const grouped = {};
      rows.forEach(row => {
        const key = row[mapping.user_email];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
      });

      for (const key in grouped) {
        const groupRows = grouped[key];
        const first = groupRows[0];
        const mapped = {};
        for (const k in mapping) {
          mapped[k] = first[mapping[k]] || '';
        }

        const products = groupRows.map(r => ({
          name: r[mapping.product_name],
          price: parseFloat(r[mapping.amount] || 0),
          tax: parseFloat(r[mapping.tax_amount] || 0)
        }));

        try {
          const invoiceNumber = `${prefix}${String(rechnungsNummerCounter++).padStart(4, '0')}`;
          generateInvoice(mapped, companyData, invoiceNumber, taxRate, outputFolder, products);
          localStorage.setItem('invoiceCounter', rechnungsNummerCounter.toString());
        } catch (err) {
          console.error("Fehler beim Erzeugen:", err);
        }
      }

      const statusBox = document.getElementById('status');
      statusBox.classList.remove('d-none', 'alert-danger');
      statusBox.classList.add('alert-success');
      statusBox.textContent = `✅ ${Object.keys(grouped).length} Rechnungen wurden erfolgreich erzeugt.`;
    });
}

function generateInvoice(data, companyData, invoiceNumber, taxRate, outputFolder, products) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const fullName = `${data.first_name} ${data.last_name}`;
  const safeName = fullName.replace(/[^a-z0-9]/gi, '_');
  const filename = `Rechnung_${invoiceNumber}_${safeName}.pdf`;
  const outputPath = path.join(outputFolder, filename);

  doc.pipe(fs.createWriteStream(outputPath));
  generateInvoiceContent(doc, data, companyData, invoiceNumber, taxRate, products);
  doc.end();
}

function createInvoicePdfBuffer(data, companyData, invoiceNumber, taxRate, products) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      generateInvoiceContent(doc, data, companyData, invoiceNumber, taxRate, products);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function generateInvoiceContent(doc, data, companyData, invoiceNumber, taxRate, products) {
  const fullName = `${data.first_name} ${data.last_name}`;
  const date = data.created_at?.split(' ')[0] || new Date().toISOString().split('T')[0];

  const logoDataUrl = localStorage.getItem('companyLogo');
  if (logoDataUrl) {
    try {
      const logoBase64 = logoDataUrl.split(',')[1];
      const logoBuffer = Buffer.from(logoBase64, 'base64');
      doc.image(logoBuffer, 400, 60, { width: 150 });
    } catch (e) {
      console.warn('Logo konnte nicht geladen werden:', e.message);
    }
  }

  doc.fontSize(8).text(`${companyData.owner || ''} - ${companyData.address || ''} - ${companyData.city || ''}`, 50, 40);

  doc.fontSize(12).font('Helvetica-Bold').text(fullName, 50, 80);
  let y = 100;
  if (data.street) { doc.font('Helvetica').text(data.street, 50, y); y += 15; }
  if (data.zip || data.city) { doc.text(`${data.zip} ${data.city}`.trim(), 50, y); y += 15; }
  if (data.country) { doc.text(data.country, 50, y); y += 15; }

  const rechtsStart = 400;
  doc.fontSize(10);
  doc.text(`Rechnungs-Nr.: ${invoiceNumber}`, rechtsStart, 180);
  doc.text(`Rechnungsdatum: ${date}`, rechtsStart);
  doc.text(`Lieferdatum: ${date}`, rechtsStart);

  doc.fontSize(16).font('Helvetica-Bold').text('Rechnung', 50, 200);
  doc.rect(50, 230, 500, 20).fill('#eee');

  doc.fillColor('#000').fontSize(10).font('Helvetica-Bold');
  doc.text('Pos.', 55, 235);
  doc.text('Beschreibung', 90, 235);
  doc.text('Menge', 330, 235, { align: 'right', width: 50 });
  doc.text('Einzelpreis', 390, 235, { align: 'right', width: 70 });
  doc.text('Gesamtpreis', 470, 235, { align: 'right', width: 70 });

  doc.font('Helvetica');
  let posY = 255;
  let nettoSum = 0;
  let steuerSum = 0;

  products.forEach((item, i) => {
    const brutto = item.price + item.tax;
    nettoSum += item.price;
    steuerSum += item.tax;

    doc.text(`${i + 1}.`, 55, posY);
    doc.text(item.name, 90, posY, { width: 220 });
    doc.text(`1.00`, 330, posY, { align: 'right', width: 50 });
    doc.text(`${item.price.toFixed(2)} EUR`, 390, posY, { align: 'right', width: 70 });
    doc.text(`${brutto.toFixed(2)} EUR`, 470, posY, { align: 'right', width: 70 });

    posY += 20;
  });

  doc.text(`Gesamtbetrag netto: ${nettoSum.toFixed(2)} EUR`, 350, posY + 15, { align: 'right' });
  doc.text(`Umsatzsteuer ${taxRate.toFixed(1)}%: ${steuerSum.toFixed(2)} EUR`, 350, posY + 30, { align: 'right' });
  doc.font('Helvetica-Bold').text(`Gesamtbetrag brutto: ${(nettoSum + steuerSum).toFixed(2)} EUR`, 350, posY + 45, { align: 'right' });

  doc.fontSize(10).font('Helvetica').text('Diese Rechnung wurde bereits bezahlt.', 50, posY + 80);

  const bottomY = 740;
  const col1 = 50, col2 = 180, col3 = 320, col4 = 460;
  doc.fontSize(7).fillColor('#666');

  doc.text(companyData.owner || '', col1, bottomY);
  doc.text(companyData.address || '', col1);
  doc.text(companyData.city || '', col1);
  doc.text(companyData.country || '', col1);

  doc.text(`Tel.: ${companyData.phone || ''}`, col2, bottomY);
  doc.text(`E-Mail: ${companyData.email || ''}`, col2);
  doc.text(`Web: ${companyData.website || ''}`, col2);

  doc.text(`Steuer-Nr.: ${companyData.taxNumber || ''}`, col3, bottomY);
  doc.text(`Inhaber/-in: ${companyData.owner || ''}`, col3);

  doc.text(companyData.bank || '', col4, bottomY);
  doc.text(`IBAN: ${companyData.iban || ''}`, col4, bottomY + 8);
}