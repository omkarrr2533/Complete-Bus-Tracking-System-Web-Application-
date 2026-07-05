package com.citybus.security;

import com.citybus.domain.UserAccount;
import com.citybus.domain.UserRole;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtServiceTest {

    private static final String SECRET = "unit-test-secret-key-that-is-long-enough-123456";

    private final JwtService jwtService = new JwtService(SECRET, 60);

    private UserAccount admin() {
        return new UserAccount("admin", "hash", "Fleet Administrator", UserRole.ADMIN, null);
    }

    @Test
    void issuedTokenRoundTripsWithClaims() {
        String token = jwtService.issueToken(admin());

        Optional<Claims> claims = jwtService.parse(token);

        assertThat(claims).isPresent();
        assertThat(claims.get().getSubject()).isEqualTo("admin");
        assertThat(claims.get().get(JwtService.CLAIM_ROLE, String.class)).isEqualTo("ADMIN");
        assertThat(claims.get().get(JwtService.CLAIM_DISPLAY_NAME, String.class))
                .isEqualTo("Fleet Administrator");
    }

    @Test
    void tamperedTokenIsRejected() {
        String token = jwtService.issueToken(admin());
        String tampered = token.substring(0, token.length() - 4) + "abcd";

        assertThat(jwtService.parse(tampered)).isEmpty();
    }

    @Test
    void tokenSignedWithDifferentKeyIsRejected() {
        JwtService other = new JwtService("another-secret-key-that-is-also-long-enough-!!", 60);
        String foreignToken = other.issueToken(admin());

        assertThat(jwtService.parse(foreignToken)).isEmpty();
    }

    @Test
    void expiredTokenIsRejected() {
        JwtService expiring = new JwtService(SECRET, 0); // expires immediately
        String token = expiring.issueToken(admin());

        assertThat(expiring.parse(token)).isEmpty();
    }

    @Test
    void garbageInputIsRejectedNotThrown() {
        assertThat(jwtService.parse("not-a-jwt")).isEmpty();
        assertThat(jwtService.parse("")).isEmpty();
    }

    @Test
    void weakSecretFailsFastAtConstruction() {
        assertThatThrownBy(() -> new JwtService("too-short", 60))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 bytes");
    }
}
