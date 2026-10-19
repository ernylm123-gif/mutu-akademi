# Supabase CLI'ya erişim belirteci ile giriş yapar.
# Belirteç gizli girilir (ekranda görünmez) ve yalnızca Supabase CLI'nın güvenli deposuna kaydedilir.
# Belirteç oluşturma: https://supabase.com/dashboard/account/tokens
$secure = Read-Host -Prompt 'Supabase erisim belirtecini yapistirin (sbp_...)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  npx supabase login --token $token --name mutu-akademi-cli
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable token -ErrorAction SilentlyContinue
}
npx supabase projects list
