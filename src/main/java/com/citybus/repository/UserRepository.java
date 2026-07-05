package com.citybus.repository;

import com.citybus.domain.UserAccount;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<UserAccount, Long> {

    @EntityGraph(attributePaths = {"bus"})
    Optional<UserAccount> findByUsername(String username);

    boolean existsByBusId(Long busId);
}
