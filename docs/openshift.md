# OpenShift Deployment

The manifest targets the existing `chess` namespace, HTTPS Route, and 200 GiB claim `wintrchess-mongodb`. It deploys one WintrChess pod and one MongoDB pod; the database claim is retained across restarts and is not recreated by this manifest. MongoDB uses the amd64 image copied to `docker.io/oronsh100/mongo:8.0`, matching the cluster node architecture.

Analysis CAPTCHA/session enforcement is disabled with `DISABLE_ANALYSIS_AUTH=true` to allow unauthenticated engine requests. This makes the CPU-intensive analysis endpoints public; apply ingress rate limits or re-enable auth before exposing the service broadly.

## Create the Docker Hub pull secret

Both images use Docker Hub, and unauthenticated pulls can hit its rate limit. After `docker login`, create `dockerhub-pull` from the Docker Desktop credential helper. This keeps the credential out of the command line and removes the temporary config file afterward. Do not replace an existing pull secret without checking its use.

```powershell
$config = Get-Content (Join-Path $env:USERPROFILE '.docker\config.json') -Raw | ConvertFrom-Json
$helper = "docker-credential-$($config.credsStore)"
$credentialJson = 'https://index.docker.io/v1/' | & $helper get
$credential = $credentialJson | ConvertFrom-Json
$authBytes = [Text.Encoding]::UTF8.GetBytes("$($credential.Username):$($credential.Secret)")
$auth = [Convert]::ToBase64String($authBytes)
$registryAuth = @{ username = $credential.Username; password = $credential.Secret; auth = $auth }
$dockerConfigJson = @{ auths = @{ 'https://index.docker.io/v1/' = $registryAuth } } | ConvertTo-Json -Depth 5 -Compress
$tempPath = Join-Path $env:TEMP ("dockerhub-pull-" + [guid]::NewGuid().ToString('N') + '.json')
try {
	[IO.File]::WriteAllText($tempPath, $dockerConfigJson, [Text.UTF8Encoding]::new($false))
	oc create secret generic dockerhub-pull --from-file=.dockerconfigjson=$tempPath --type=kubernetes.io/dockerconfigjson -n chess
}
finally {
	Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
	if ($authBytes) { [Array]::Clear($authBytes, 0, $authBytes.Length) }
	$credential = $null
	$credentialJson = $null
	$dockerConfigJson = $null
	$auth = $null
}
```

## Create the auth secret

The app requires `AUTH_SECRET`. Generate a random value in PowerShell without displaying it, then create the Kubernetes Secret:

```powershell
$bytes = [byte[]]::new(32)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$authSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
& oc create secret generic wintrchess-auth --from-literal="AUTH_SECRET=$authSecret" -n chess
Remove-Variable authSecret, bytes, rng
```

If `wintrchess-auth` already exists, do not replace it blindly; have a namespace administrator confirm its contents and required key.

## Apply

From the repository root, with a role that can manage Deployments, Services, Routes, NetworkPolicies, and ConfigMaps in `chess`:

```powershell
oc apply -f deploy/openshift.yaml
oc rollout status deployment/wintrchess-mongodb -n chess
oc rollout status deployment/wintrchess -n chess
```

Then open <https://wintrchess-chess.apps.rnd.gpu.central.cks.med.one>.

## Resource profile

The WintrChess container requests 200 CPU cores and 512 GiB of memory, with limits of 220 cores and 640 GiB. MongoDB requests 4 cores and 16 GiB, with limits of 8 cores and 32 GiB. Against the node's 255.5 allocatable cores and roughly 754 GiB allocatable memory, this reserves most compute for analysis while leaving additional CPU headroom for OpenShift and other workloads. Stockfish defaults to 64 threads per search, which measured about 58 CPU cores in an 8-second live test. The image includes the CPU Stockfish 19 binary, so it does not request an NVIDIA GPU; the five A10 GPUs remain available to workloads that can use them.

MongoDB is unauthenticated to match the project's Compose setup. The included NetworkPolicy limits database ingress to WintrChess pods in this namespace. Do not expose the MongoDB Service through a Route or LoadBalancer.

Email verification and Google sign-in require their corresponding SMTP/OAuth environment variables; they are not configured by this base manifest.