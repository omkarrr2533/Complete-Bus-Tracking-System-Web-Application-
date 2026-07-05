package com.citybus.exception;

public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String resource, Object id) {
        super(resource + " not found: " + id);
    }

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
