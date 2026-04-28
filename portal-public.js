/* ===== AXSUMA — Public Order Form JS (no auth check) ===== */

/* -- Repeatable Sections -- */
function addRepeatable(btnEl, templateId, containerId) {
  var container = document.getElementById(containerId);
  var template = document.getElementById(templateId);
  if (!template || !container) return;
  var count = container.querySelectorAll('.repeatable').length + 1;
  var clone = template.content.cloneNode(true);
  var heading = clone.querySelector('h4');
  if (heading) heading.textContent = heading.textContent.replace('#N', '#' + count);
  clone.querySelectorAll('[name]').forEach(function(el) {
    el.name = el.name.replace('__IDX__', count - 1);
  });
  container.appendChild(clone);
}

function removeRepeatable(btn) {
  var block = btn.closest('.repeatable');
  if (block) block.remove();
}

/* -- Collect Form Data as JSON -- */
function collectFormData(formEl) {
  var data = {};
  var fd = new FormData(formEl);
  fd.forEach(function(value, key) {
    if (data[key]) {
      if (!Array.isArray(data[key])) data[key] = [data[key]];
      data[key].push(value);
    } else {
      data[key] = value;
    }
  });
  return data;
}

/* -- Submit Form -- */
async function submitPortalForm(formEl, formType) {
  var btn = formEl.querySelector('button[type="submit"]');
  var origText = btn ? btn.innerHTML : '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    }
    var data = collectFormData(formEl);
    data._formType = formType;
    data._submittedAt = new Date().toISOString();

    var res = await fetch('/api/portal/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) throw new Error('Server error ' + res.status);

    var overlay = document.getElementById('successOverlay');
    if (overlay) overlay.classList.add('show');
    return true;
  } catch (err) {
    alert('There was an error submitting the form. Please try again or contact enquiries@axsuma.co.uk.');
    console.error(err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
    return false;
  }
}

/* -- Form Validation Helpers -- */
function validateRequired(formEl) {
  var invalid = formEl.querySelectorAll(':invalid');
  if (invalid.length > 0) {
    invalid[0].focus();
    invalid[0].reportValidity();
    return false;
  }
  return true;
}
