alter table public.forms
  add column scope text not null default 'customer'
    check (scope in ('customer', 'internal')),
  add column customer_prompt_timing text
    check (customer_prompt_timing in ('pre_booking', 'pre_visit', 'post_visit'));

update public.forms
set customer_prompt_timing = 'pre_booking'
where scope = 'customer' and customer_prompt_timing is null;

alter table public.forms
  alter column customer_prompt_timing set default 'pre_booking';

alter table public.forms
  add constraint forms_scope_timing_consistency
  check (
    (scope = 'customer' and customer_prompt_timing is not null)
    or (scope = 'internal' and customer_prompt_timing is null)
  );