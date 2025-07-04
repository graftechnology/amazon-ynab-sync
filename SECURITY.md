# Security Guidelines

## Environment Variables

**NEVER** commit your `.env` file to version control. It contains sensitive credentials.

### Required Security Practices:

1. **Use App Passwords**: For Gmail and most email providers, use app-specific passwords instead of your main account password.

2. **YNAB Token Security**:

   - Generate a new Personal Access Token in YNAB settings
   - Store it securely and never share it
   - Rotate tokens periodically

3. **Environment File Protection**:

   ```bash
   # Set proper permissions on .env file
   chmod 600 .env
   ```

4. **Docker Security**:
   - The application runs as non-root user in containers
   - Resource limits are enforced in docker-compose
   - Health checks monitor container status

## Production Deployment

### Recommended Security Measures:

1. **Use Docker Secrets** (for Docker Swarm):

   ```yaml
   secrets:
     ynab_token:
       external: true
     imap_password:
       external: true
   ```

2. **Use Kubernetes Secrets** (for Kubernetes):

   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: amazon-ynab-sync-secrets
   type: Opaque
   data:
     ynab-token: <base64-encoded-token>
     imap-password: <base64-encoded-password>
   ```

3. **Network Security**:

   - Run in isolated Docker networks
   - Use TLS for all connections (IMAP and YNAB API)
   - Consider VPN for additional security

4. **Monitoring**:
   - Monitor container logs for suspicious activity
   - Set up alerts for authentication failures
   - Regular security updates of base images

## Reporting Security Issues

If you discover a security vulnerability, please email security@graftechnology.com instead of opening a public issue.
