-- Review and run in the Supabase SQL Editor for lpcmwrdizcistkxylsps.
-- This configures the two buckets created by the project owner. It does not
-- create accounts, grant admins, or copy private records out of Firestore.
begin;

do $$
begin
  if (select count(*) from storage.buckets where id in ('announcement-images', 'report-images')) <> 2 then
    raise exception 'Create announcement-images and report-images buckets first.';
  end if;
end $$;

update storage.buckets
set public = (id = 'announcement-images'),
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('announcement-images', 'report-images');

-- Restrictive policy keeps both buckets inaccessible to direct browser API
-- operations, even if a general permissive policy is added elsewhere later.
-- Public announcement URLs still work via Storage's public serving endpoint.
-- The Edge Function uses the server-only service role after checking Firebase.
drop policy if exists "capstone_images_server_only" on storage.objects;
create policy "capstone_images_server_only"
on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id not in ('announcement-images', 'report-images'))
with check (bucket_id not in ('announcement-images', 'report-images'));

commit;
