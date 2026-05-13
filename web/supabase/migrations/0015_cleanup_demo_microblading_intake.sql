do $$
declare
  v_tenant_id uuid;
  v_form_id constant uuid := '7620170d-0ae4-44f4-a615-130c625cccfc';
  v_new_version_id constant uuid := 'a1f4b8de-9192-47c6-98c5-387713dafea5';
  v_next_version integer;
  v_schema jsonb := $schema$
  {
    "fields": [
      {
        "id": "intro",
        "type": "static_text",
        "label": "",
        "required": false,
        "body": "Please complete this form before your microblading appointment. Your answers help us plan safely and personalize your brow design."
      },
      {
        "id": "goals",
        "type": "long_text",
        "label": "What are your brow goals for this appointment?",
        "required": true,
        "help_text": "Share the look you want, any concerns, or what you hope to improve."
      },
      {
        "id": "previous-brow-work",
        "type": "yes_no",
        "label": "Have you had previous microblading, permanent makeup, or brow tattooing in this area?",
        "required": true
      },
      {
        "id": "recent-actives",
        "type": "yes_no",
        "label": "Have you used retinol, tretinoin, acids, or strong exfoliants on the brow area in the last 7 days?",
        "required": true
      },
      {
        "id": "considerations",
        "type": "multi_select",
        "label": "Select any that apply",
        "required": false,
        "options": [
          "Pregnant or nursing",
          "Blood thinner use",
          "History of keloid scarring",
          "Recent Botox or fillers near the brow area",
          "Active irritation, rash, or broken skin near the brows",
          "None of the above"
        ]
      },
      {
        "id": "allergies-notes",
        "type": "long_text",
        "label": "Allergies, sensitivities, or medical notes we should know about",
        "required": false
      },
      {
        "id": "reference-photo",
        "type": "file_upload",
        "label": "Upload a reference photo (optional)",
        "required": false,
        "help_text": "You can share brow inspiration or a recent photo of your natural brows.",
        "upload_kind": "photo",
        "max_files": 5
      },
      {
        "id": "consent",
        "type": "checkbox",
        "label": "I confirm my answers are accurate and understand my provider may adjust or reschedule treatment based on this intake.",
        "required": true
      },
      {
        "id": "signature-section",
        "type": "section",
        "label": "Signature",
        "required": false,
        "body": "Please sign to confirm that the information above is complete and accurate."
      },
      {
        "id": "signature",
        "type": "signature",
        "label": "Client signature",
        "required": true
      }
    ]
  }
  $schema$::jsonb;
begin
  select id into v_tenant_id
  from public.tenants
  where slug = 'brow-beauty-lab';

  if v_tenant_id is null then
    return;
  end if;

  update public.forms
  set
    name = 'Microblading Intake',
    description = 'Pre-appointment intake covering goals, recent skincare, relevant considerations, optional reference photos, and signature.'
  where id = v_form_id
    and tenant_id = v_tenant_id;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from public.form_versions
    where id = v_new_version_id
  ) then
    select coalesce(max(version_number), 0) + 1
    into v_next_version
    from public.form_versions
    where form_id = v_form_id;

    insert into public.form_versions (
      id,
      tenant_id,
      form_id,
      version_number,
      schema_json
    )
    values (
      v_new_version_id,
      v_tenant_id,
      v_form_id,
      v_next_version,
      v_schema
    );
  end if;

  update public.forms
  set current_version_id = v_new_version_id
  where id = v_form_id
    and tenant_id = v_tenant_id;

  update public.booking_form_requirements
  set
    form_version_id = v_new_version_id,
    draft_answers_json = null,
    draft_saved_at = null
  where tenant_id = v_tenant_id
    and form_id = v_form_id
    and satisfied_by_response_id is null;
end;
$$;