package com.citybus.service;

import com.citybus.domain.UserAccount;
import com.citybus.dto.LoginRequest;
import com.citybus.dto.LoginResponse;
import com.citybus.repository.UserRepository;
import com.citybus.security.JwtService;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Credential verification against the persisted user store (BCrypt hashes)
 * and token issuance. Uses one generic failure message so the endpoint does
 * not leak which usernames exist.
 */
@Service
public class AuthService {

    private static final String INVALID_CREDENTIALS = "Invalid username or password";

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @Transactional(readOnly = true)
    public LoginResponse login(LoginRequest request) {
        UserAccount user = userRepository.findByUsername(request.username().trim())
                .orElseThrow(() -> new BadCredentialsException(INVALID_CREDENTIALS));
        if (!user.isEnabled() || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new BadCredentialsException(INVALID_CREDENTIALS);
        }
        return new LoginResponse(
                jwtService.issueToken(user),
                "Bearer",
                jwtService.getExpirationSeconds(),
                user.getUsername(),
                user.getDisplayName(),
                user.getRole().name(),
                user.getBus() == null ? null : user.getBus().getCode()
        );
    }

    @Transactional(readOnly = true)
    public LoginResponse currentUser(String username) {
        UserAccount user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BadCredentialsException("Unknown user"));
        return new LoginResponse(
                null,
                null,
                0,
                user.getUsername(),
                user.getDisplayName(),
                user.getRole().name(),
                user.getBus() == null ? null : user.getBus().getCode()
        );
    }
}
